use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

const API_PORT: u16 = 3001;
const MAX_RECENT: usize = 10;

#[derive(Default)]
struct ApiState {
  child: Mutex<Option<Child>>,
  data_dir: Mutex<Option<PathBuf>>,
}

#[derive(Serialize, Deserialize, Clone)]
struct RecentProfile {
  name: String,
  path: String,
}

#[derive(Serialize, Deserialize, Default)]
struct AppConfig {
  data_dir: Option<String>,
  #[serde(default)]
  recent: Vec<RecentProfile>,
}

#[derive(Serialize)]
struct FolderPickResult {
  path: String,
}

#[derive(Serialize)]
struct ProfileOpenResult {
  path: String,
  name: String,
}

fn strip_extended_prefix(p: PathBuf) -> PathBuf {
  let s = p.to_string_lossy();
  if let Some(rest) = s.strip_prefix(r"\\?\") {
    PathBuf::from(rest)
  } else {
    p
  }
}

#[cfg(debug_assertions)]
fn repo_root() -> PathBuf {
  let raw = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..");
  let canonical = raw.canonicalize().unwrap_or(raw);
  strip_extended_prefix(canonical)
}

/// Añade directorios típicos de Node/pnpm al PATH del proceso hijo (apps GUI de Windows
/// no heredan el PATH del usuario de la misma forma que una terminal).
#[cfg(debug_assertions)]
fn path_with_node_tools() -> std::ffi::OsString {
  let mut entries: Vec<PathBuf> = Vec::new();

  #[cfg(windows)]
  {
    if let Ok(appdata) = std::env::var("APPDATA") {
      entries.push(PathBuf::from(appdata).join("npm"));
    }
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
      entries.push(PathBuf::from(&local).join("pnpm"));
      entries.push(PathBuf::from(local).join("Programs").join("nodejs"));
    }
    entries.push(PathBuf::from(r"C:\Program Files\nodejs"));
    entries.push(PathBuf::from(r"C:\Program Files (x86)\nodejs"));
  }

  #[cfg(not(windows))]
  {
    if let Ok(home) = std::env::var("HOME") {
      entries.push(PathBuf::from(&home).join(".local").join("share").join("pnpm"));
      entries.push(PathBuf::from(home).join(".nvm").join("current").join("bin"));
    }
    entries.push(PathBuf::from("/usr/local/bin"));
  }

  let mut parts: Vec<std::ffi::OsString> = entries
    .into_iter()
    .filter(|p| p.exists())
    .map(|p| p.into_os_string())
    .collect();

  if let Some(existing) = std::env::var_os("PATH") {
    parts.push(existing);
  }

  let joined = std::env::join_paths(parts).unwrap_or_else(|_| {
    std::env::var_os("PATH").unwrap_or_default()
  });
  joined
}

#[cfg(debug_assertions)]
fn find_pnpm() -> Result<PathBuf, String> {
  #[cfg(windows)]
  {
    let candidates = [
      std::env::var_os("APPDATA").map(|a| PathBuf::from(a).join("npm").join("pnpm.cmd")),
      std::env::var_os("LOCALAPPDATA").map(|a| PathBuf::from(a).join("pnpm").join("pnpm.exe")),
      Some(PathBuf::from(r"C:\Program Files\nodejs\pnpm.cmd")),
    ];
    for c in candidates.into_iter().flatten() {
      if c.is_file() {
        return Ok(c);
      }
    }
    // Último recurso: que el PATH aumentado lo resuelva
    Ok(PathBuf::from("pnpm.cmd"))
  }
  #[cfg(not(windows))]
  {
    Ok(PathBuf::from("pnpm"))
  }
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
  let dir = app
    .path()
    .app_config_dir()
    .map_err(|e| e.to_string())?;
  fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
  Ok(dir.join("config.json"))
}

fn load_config(app: &AppHandle) -> AppConfig {
  let Ok(path) = config_path(app) else {
    return AppConfig::default();
  };
  let Ok(raw) = fs::read_to_string(path) else {
    return AppConfig::default();
  };
  // Compat: recent may have been written as RecentVault shape (same fields)
  serde_json::from_str(&raw).unwrap_or_default()
}

fn save_config(app: &AppHandle, cfg: &AppConfig) -> Result<(), String> {
  let path = config_path(app)?;
  let raw = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
  fs::write(path, raw).map_err(|e| e.to_string())
}

const PROFILE_KIND: &str = "autonomous-profile";
const PROFILE_FORMAT_VERSION: u32 = 1;

fn iso_now() -> String {
  use std::time::{SystemTime, UNIX_EPOCH};
  let secs = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map(|d| d.as_secs())
    .unwrap_or(0);
  // Enough for vault metadata; API may rewrite with full ISO later.
  format!("{secs}")
}

fn read_vault_loose(data_dir: &Path) -> Option<(String, String, Option<String>)> {
  let vault_json = data_dir.join("vault.json");
  let raw = fs::read_to_string(&vault_json).ok()?;
  let v: serde_json::Value = serde_json::from_str(&raw).ok()?;
  let name = v.get("name").and_then(|x| x.as_str())?.trim();
  if name.is_empty() {
    return None;
  }
  let created = v
    .get("createdAt")
    .and_then(|x| x.as_str())
    .filter(|s| !s.is_empty())
    .unwrap_or("")
    .to_string();
  let created = if created.is_empty() {
    iso_now()
  } else {
    created
  };
  let kind = v
    .get("kind")
    .and_then(|x| x.as_str())
    .map(|s| s.to_string());
  Some((name.to_string(), created, kind))
}

fn is_profile_dir(data_dir: &Path) -> bool {
  if !data_dir.is_dir() {
    return false;
  }
  let Some((.., kind)) = read_vault_loose(data_dir) else {
    return false;
  };
  if kind.as_deref() == Some(PROFILE_KIND) {
    return true;
  }
  // Legacy: name + SQLite (empty accidental vault.json alone is NOT a profile)
  data_dir.join("autonomous.db").is_file()
}

fn write_profile_meta(data_dir: &Path, name: &str, created_at: &str) -> Result<(), String> {
  let meta = serde_json::json!({
    "kind": PROFILE_KIND,
    "formatVersion": PROFILE_FORMAT_VERSION,
    "name": name,
    "createdAt": created_at,
  });
  fs::write(
    data_dir.join("vault.json"),
    serde_json::to_string_pretty(&meta).map_err(|e| e.to_string())?,
  )
  .map_err(|e| e.to_string())
}

fn upgrade_profile_meta(data_dir: &Path, preferred_name: Option<&str>) -> Result<String, String> {
  if !is_profile_dir(data_dir) {
    return Err(format!(
      "«{}» no es un perfil de Auto-Gnomo.",
      data_dir.display()
    ));
  }
  let (loose_name, created, _) = read_vault_loose(data_dir).ok_or_else(|| {
    format!(
      "«{}» no tiene vault.json válido.",
      data_dir.display()
    )
  })?;
  let name = preferred_name
    .map(str::trim)
    .filter(|s| !s.is_empty())
    .unwrap_or(loose_name.as_str())
    .to_string();
  write_profile_meta(data_dir, &name, &created)?;
  Ok(name)
}

fn list_profile_children(parent: &Path) -> Vec<PathBuf> {
  let Ok(entries) = fs::read_dir(parent) else {
    return Vec::new();
  };
  let mut out = Vec::new();
  for entry in entries.flatten() {
    let path = entry.path();
    if path.is_dir() && is_profile_dir(&path) {
      out.push(path);
    }
  }
  out.sort();
  out
}

/// Open path if it is a profile; else if exactly one child profile, use that.
fn resolve_profile_dir(path: &Path) -> Result<(PathBuf, String), String> {
  if path.as_os_str().is_empty() {
    return Err("La ruta de la carpeta está vacía".into());
  }
  if !path.exists() {
    return Err(format!("La carpeta «{}» no existe", path.display()));
  }
  if !path.is_dir() {
    return Err(format!("«{}» no es una carpeta", path.display()));
  }

  if is_profile_dir(path) {
    let name = upgrade_profile_meta(path, None)?;
    return Ok((path.to_path_buf(), name));
  }

  let children = list_profile_children(path);
  if children.len() == 1 {
    let child = &children[0];
    let name = upgrade_profile_meta(child, None)?;
    return Ok((child.clone(), name));
  }
  if children.len() > 1 {
    let list = children
      .iter()
      .map(|c| format!("• {}", c.display()))
      .collect::<Vec<_>>()
      .join("\n");
    return Err(format!(
      "«{}» no es un perfil, pero contiene varios. Abre uno de estos:\n{list}",
      path.display()
    ));
  }

  let label = path
    .file_name()
    .and_then(|s| s.to_str())
    .unwrap_or_else(|| path.to_str().unwrap_or("carpeta"));
  Err(format!(
    "«{label}» no es un perfil de Auto-Gnomo. Elige la carpeta que contiene vault.json (creada con «Crear perfil»), no una carpeta padre genérica."
  ))
}

fn prepare_create_profile_dir(
  parent: &Path,
  profile_name: &str,
) -> Result<(PathBuf, String), String> {
  let name = profile_name.trim();
  if name.is_empty() {
    return Err("Indica un nombre para el perfil".into());
  }
  let folder = sanitize_dir_name(name);
  let data_dir = parent.join(&folder);
  if is_profile_dir(&data_dir) {
    return Err(format!("Ya existe un perfil en «{}»", data_dir.display()));
  }
  fs::create_dir_all(&data_dir).map_err(|e| {
    format!(
      "No se pudo crear la carpeta «{}»: {e}",
      data_dir.display()
    )
  })?;
  write_profile_meta(&data_dir, name, &iso_now())?;
  Ok((data_dir, name.to_string()))
}

fn push_recent(cfg: &mut AppConfig, name: &str, path: &str) {
  cfg.recent.retain(|r| r.path != path);
  cfg.recent.insert(
    0,
    RecentProfile {
      name: name.to_string(),
      path: path.to_string(),
    },
  );
  if cfg.recent.len() > MAX_RECENT {
    cfg.recent.truncate(MAX_RECENT);
  }
}

fn path_key(p: &str) -> String {
  p.trim()
    .trim_end_matches(['/', '\\'])
    .replace('/', "\\")
    .to_ascii_lowercase()
}

fn paths_equal(a: &str, b: &str) -> bool {
  path_key(a) == path_key(b)
}

/// GET /health and return dataDir when the JSON body is valid.
fn fetch_health_data_dir() -> Option<String> {
  let addr = format!("127.0.0.1:{API_PORT}");
  let mut stream = TcpStream::connect_timeout(
    &addr.parse().ok()?,
    Duration::from_millis(500),
  )
  .ok()?;
  stream
    .set_read_timeout(Some(Duration::from_millis(2_000)))
    .ok()?;
  stream
    .set_write_timeout(Some(Duration::from_millis(2_000)))
    .ok()?;
  let req = format!(
    "GET /health HTTP/1.1\r\nHost: 127.0.0.1:{API_PORT}\r\nConnection: close\r\n\r\n"
  );
  stream.write_all(req.as_bytes()).ok()?;
  let mut buf = Vec::new();
  stream.read_to_end(&mut buf).ok()?;
  let text = String::from_utf8_lossy(&buf);
  let body = text.split("\r\n\r\n").nth(1)?;
  let v: serde_json::Value = serde_json::from_str(body.trim()).ok()?;
  v.get("dataDir")
    .and_then(|x| x.as_str())
    .filter(|s| !s.is_empty())
    .map(|s| s.to_string())
}

/// Wait until /health reports the expected profile folder (not just TCP open).
fn wait_for_api(expected_data_dir: &Path, timeout_ms: u64) -> Result<(), String> {
  let expected = expected_data_dir.to_string_lossy().to_string();
  let deadline = std::time::Instant::now() + Duration::from_millis(timeout_ms);
  let mut last_seen: Option<String> = None;
  while std::time::Instant::now() < deadline {
    if let Some(dir) = fetch_health_data_dir() {
      last_seen = Some(dir.clone());
      if paths_equal(&dir, &expected) {
        return Ok(());
      }
    }
    thread::sleep(Duration::from_millis(250));
  }
  match last_seen {
    Some(other) => Err(format!(
      "La API en :{API_PORT} sirve otra carpeta («{other}»), no «{expected}». Cierra otras instancias o libera el puerto."
    )),
    None => Err(format!(
      "La API no respondió en http://127.0.0.1:{API_PORT} (DATA_DIR={expected})"
    )),
  }
}

/// Kill process tree rooted at `pid` (Windows: taskkill /T).
fn kill_pid_tree(pid: u32) {
  #[cfg(windows)]
  {
    let _ = Command::new("taskkill")
      .args(["/F", "/T", "/PID", &pid.to_string()])
      .stdout(Stdio::null())
      .stderr(Stdio::null())
      .status();
  }
  #[cfg(not(windows))]
  {
    let _ = Command::new("kill")
      .args(["-TERM", &pid.to_string()])
      .stdout(Stdio::null())
      .stderr(Stdio::null())
      .status();
  }
}

/// Free anything still listening on the API port (orphan node/pnpm from a prior session).
fn free_api_port() {
  #[cfg(windows)]
  {
    let script = format!(
      "$pids = Get-NetTCPConnection -LocalPort {API_PORT} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique; foreach ($p in $pids) {{ taskkill /F /T /PID $p 2>$null }}"
    );
    let _ = Command::new("powershell")
      .args(["-NoProfile", "-NonInteractive", "-Command", &script])
      .stdout(Stdio::null())
      .stderr(Stdio::null())
      .status();
  }
  #[cfg(not(windows))]
  {
    let _ = Command::new("sh")
      .args([
        "-c",
        &format!("fuser -k {API_PORT}/tcp 2>/dev/null || true"),
      ])
      .stdout(Stdio::null())
      .stderr(Stdio::null())
      .status();
  }
  // Brief pause so the OS releases the bind.
  thread::sleep(Duration::from_millis(300));
}

fn assistant_dir() -> PathBuf {
  #[cfg(windows)]
  {
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
      return PathBuf::from(local).join("Autonomous").join("assistant");
    }
  }
  let home = std::env::var("HOME")
    .or_else(|_| std::env::var("USERPROFILE"))
    .unwrap_or_else(|_| ".".into());
  PathBuf::from(home).join(".autonomous").join("assistant")
}

#[cfg(not(debug_assertions))]
fn apply_api_env(cmd: &mut Command, data_dir: &Path) {
  cmd
    .env("DATA_DIR", data_dir)
    .env("ASSISTANT_DIR", assistant_dir())
    .env("API_HOST", "127.0.0.1")
    .env("API_PORT", API_PORT.to_string())
    .env("CORS_ORIGIN", "*")
    .env("NODE_ENV", "production")
    .stdin(Stdio::null())
    .stdout(Stdio::null())
    .stderr(Stdio::null());

  #[cfg(windows)]
  {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    cmd.creation_flags(CREATE_NO_WINDOW);
  }
}

/// Dev: pnpm/tsx contra el monorepo. Release: Node + API empaquetados en resources.
fn spawn_api_process(app: &AppHandle, data_dir: &Path) -> Result<Child, String> {
  let data_dir = strip_extended_prefix(data_dir.to_path_buf());

  #[cfg(debug_assertions)]
  {
    let _ = app;
    let root = repo_root();
    let pnpm = find_pnpm()?;
    let path_env = path_with_node_tools();
    let pnpm_args = [
      "--filter",
      "@autonomous/api",
      "exec",
      "tsx",
      "src/index.ts",
    ];

    #[cfg(windows)]
    let mut cmd = {
      let mut c = Command::new("cmd");
      c.arg("/C");
      c.arg(&pnpm);
      c.args(pnpm_args);
      c
    };
    #[cfg(not(windows))]
    let mut cmd = {
      let mut c = Command::new(&pnpm);
      c.args(pnpm_args);
      c
    };

    cmd.current_dir(&root).env("PATH", &path_env);
    // En dev no forzamos NODE_ENV=production
    cmd
      .env("DATA_DIR", &data_dir)
      .env("ASSISTANT_DIR", assistant_dir())
      .env("API_HOST", "127.0.0.1")
      .env("API_PORT", API_PORT.to_string())
      .env("CORS_ORIGIN", "*")
      .stdin(Stdio::null())
      .stdout(Stdio::null())
      .stderr(Stdio::null());
    #[cfg(windows)]
    {
      use std::os::windows::process::CommandExt;
      const CREATE_NO_WINDOW: u32 = 0x0800_0000;
      cmd.creation_flags(CREATE_NO_WINDOW);
    }

    return cmd.spawn().map_err(|e| {
      format!(
        "No se pudo arrancar la API (¿pnpm/node instalados?): {e}. pnpm={} Root={}",
        pnpm.display(),
        root.display()
      )
    });
  }

  #[cfg(not(debug_assertions))]
  {
    let resource_dir = app
      .path()
      .resource_dir()
      .map_err(|e| format!("No se pudo resolver resource_dir: {e}"))?;
    let runtime = resource_dir.join("api-runtime");
    #[cfg(windows)]
    let node = runtime.join("node.exe");
    #[cfg(not(windows))]
    let node = runtime.join("node");
    let app_dir = runtime.join("app");
    // Preferir bundle ESM (server.mjs); fallback al deploy antiguo por si un build intermedio quedó a medias.
    let entry = {
      let bundled = app_dir.join("server.mjs");
      let legacy = app_dir.join("dist").join("index.js");
      if bundled.is_file() {
        bundled
      } else {
        legacy
      }
    };

    if !node.is_file() {
      return Err(format!(
        "Falta el runtime empaquetado de la API ({})",
        node.display()
      ));
    }
    if !entry.is_file() {
      return Err(format!(
        "Falta el entry de la API empaquetada ({})",
        entry.display()
      ));
    }

    let mut cmd = Command::new(&node);
    cmd.arg(&entry).current_dir(&app_dir);
    apply_api_env(&mut cmd, &data_dir);

    cmd.spawn().map_err(|e| {
      format!(
        "No se pudo arrancar la API empaquetada: {e}. node={} cwd={}",
        node.display(),
        app_dir.display()
      )
    })
  }
}

fn stop_api(state: &ApiState) {
  if let Ok(mut guard) = state.child.lock() {
    if let Some(mut child) = guard.take() {
      let pid = child.id();
      // cmd → pnpm → tsx → node: kill() on the shell alone often leaves orphans.
      kill_pid_tree(pid);
      let _ = child.kill();
      let _ = child.wait();
    }
  }
  free_api_port();
}

fn normalize_path(raw: &str) -> PathBuf {
  let t = raw
    .trim()
    .trim_matches('"')
    .trim_matches('\'')
    .trim();
  PathBuf::from(t)
}

fn sanitize_dir_name(name: &str) -> String {
  let cleaned: String = name
    .chars()
    .map(|c| {
      if "<>:\"/\\|?*".contains(c) || c.is_control() {
        '_'
      } else {
        c
      }
    })
    .collect();
  let cleaned = cleaned.trim().trim_matches('.').trim();
  if cleaned.is_empty() {
    "Perfil".to_string()
  } else {
    cleaned.to_string()
  }
}

fn to_absolute(data_dir: PathBuf) -> PathBuf {
  let absolute = data_dir.canonicalize().unwrap_or(data_dir);
  // Node en Windows a veces falla con el prefijo \\?\
  strip_extended_prefix(absolute)
}

fn open_profile_inner(
  app: &AppHandle,
  state: &ApiState,
  data_dir: PathBuf,
  name: String,
) -> Result<ProfileOpenResult, String> {
  if !is_profile_dir(&data_dir) {
    return Err(format!(
      "«{}» no es un perfil de Auto-Gnomo (falta vault.json válido).",
      data_dir.display()
    ));
  }

  stop_api(state);

  let name = upgrade_profile_meta(&data_dir, Some(&name))?;
  let data_dir = to_absolute(data_dir);

  let child = match spawn_api_process(app, &data_dir) {
    Ok(c) => c,
    Err(e) => {
      free_api_port();
      return Err(format!(
        "{e}. Si el puerto {API_PORT} estaba ocupado, reinténtalo tras cerrar otras instancias."
      ));
    }
  };
  *state.child.lock().map_err(|e| e.to_string())? = Some(child);
  *state.data_dir.lock().map_err(|e| e.to_string())? = Some(data_dir.clone());

  if let Err(e) = wait_for_api(&data_dir, 25_000) {
    stop_api(state);
    return Err(e);
  }

  let path_str = data_dir.to_string_lossy().to_string();
  let mut cfg = load_config(app);
  cfg.data_dir = Some(path_str.clone());
  push_recent(&mut cfg, &name, &path_str);
  save_config(app, &cfg)?;

  Ok(ProfileOpenResult {
    path: path_str,
    name,
  })
}

#[tauri::command]
fn get_data_dir(state: State<'_, ApiState>) -> Option<String> {
  state
    .data_dir
    .lock()
    .ok()
    .and_then(|g| g.as_ref().map(|p| p.to_string_lossy().to_string()))
}

#[tauri::command]
fn get_api_url() -> String {
  format!("http://127.0.0.1:{API_PORT}")
}

#[tauri::command]
fn has_last_profile(app: AppHandle) -> bool {
  load_config(&app)
    .data_dir
    .as_ref()
    .is_some_and(|d| !d.is_empty() && is_profile_dir(Path::new(d)))
}

#[tauri::command]
fn list_recent_profiles(app: AppHandle) -> Vec<RecentProfile> {
  load_config(&app)
    .recent
    .into_iter()
    .filter(|r| {
      let p = Path::new(&r.path);
      is_profile_dir(p) || !list_profile_children(p).is_empty()
    })
    .collect()
}

/// Quita un perfil de la lista de recientes. No borra archivos del disco.
#[tauri::command]
fn remove_recent_profile(app: AppHandle, path: String) -> Result<(), String> {
  let path = path.trim();
  if path.is_empty() {
    return Err("Ruta vacía".into());
  }
  let mut cfg = load_config(&app);
  let before = cfg.recent.len();
  cfg.recent.retain(|r| r.path != path);
  if cfg.recent.len() == before {
    return Ok(());
  }
  save_config(&app, &cfg)
}

/// Solo diálogo de carpeta; no reinicia la API.
#[tauri::command]
fn pick_folder(app: AppHandle) -> Result<FolderPickResult, String> {
  let folder = app
    .dialog()
    .file()
    .set_title("Elige la carpeta del perfil")
    .blocking_pick_folder();

  let Some(file_path) = folder else {
    return Err("CANCELLED".into());
  };

  let path_buf = file_path.into_path().map_err(|e| {
    format!("No se pudo leer la ruta elegida ({e}). Prueba otra carpeta.")
  })?;
  let path = path_buf.to_string_lossy().trim().to_string();
  if path.is_empty() {
    return Err("La carpeta elegida no devolvió una ruta válida".into());
  }
  Ok(FolderPickResult { path })
}

/// Arranca/reinicia la API con esa carpeta y la guarda como último perfil.
/// Si `create` es true y hay `name`, usa `{path}/{nombreSanitizado}` (crea la subcarpeta + marker).
/// Si `create` es false, solo abre si es un perfil válido (o un único hijo perfil).
#[tauri::command]
fn open_profile(
  app: AppHandle,
  state: State<'_, ApiState>,
  path: String,
  name: Option<String>,
  create: Option<bool>,
) -> Result<ProfileOpenResult, String> {
  let base = normalize_path(&path);
  let (dir, display_name) = if create.unwrap_or(false) {
    let profile_name = name
      .as_deref()
      .map(str::trim)
      .filter(|s| !s.is_empty())
      .ok_or_else(|| "Indica un nombre para el perfil".to_string())?;
    prepare_create_profile_dir(&base, profile_name)?
  } else {
    resolve_profile_dir(&base)?
  };
  open_profile_inner(&app, &state, dir, display_name)
}

// Compat aliases for older frontend calls during transition
#[tauri::command]
fn list_recent_vaults(app: AppHandle) -> Vec<RecentProfile> {
  list_recent_profiles(app)
}

#[tauri::command]
fn set_data_dir(
  app: AppHandle,
  state: State<'_, ApiState>,
  path: String,
  name: Option<String>,
) -> Result<ProfileOpenResult, String> {
  open_profile(app, state, path, name, Some(false))
}

#[tauri::command]
fn pick_and_set_data_dir(
  app: AppHandle,
  state: State<'_, ApiState>,
  name: Option<String>,
) -> Result<ProfileOpenResult, String> {
  let picked = pick_folder(app.clone())?;
  let create = name.as_ref().is_some_and(|n| !n.trim().is_empty());
  open_profile(app, state, picked.path, name, Some(create))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  // Antes de crear el WebView: perfil aislado + flag que evita crash en algunos Win11.
  #[cfg(windows)]
  {
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
      let webview_dir = PathBuf::from(local)
        .join("local.autonomous.app")
        .join("webview");
      let _ = fs::create_dir_all(&webview_dir);
      std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", &webview_dir);
      std::env::set_var(
        "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
        "--disable-features=RendererCodeIntegrity",
      );
    }
  }

  tauri::Builder::default()
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_process::init())
    .manage(ApiState::default())
    .invoke_handler(tauri::generate_handler![
      get_data_dir,
      get_api_url,
      has_last_profile,
      list_recent_profiles,
      remove_recent_profile,
      list_recent_vaults,
      pick_folder,
      open_profile,
      set_data_dir,
      pick_and_set_data_dir
    ])
    .setup(|app| {
      #[cfg(desktop)]
      app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;

      let handle = app.handle().clone();
      let state = app.state::<ApiState>();
      let cfg = load_config(&handle);

      // Solo reabrir si el último path sigue siendo (o resuelve a) un perfil válido
      if let Some(dir) = cfg.data_dir.filter(|d| !d.is_empty()) {
        match resolve_profile_dir(Path::new(&dir)) {
          Ok((resolved, name)) => {
            if let Err(e) = open_profile_inner(&handle, &state, resolved, name) {
              eprintln!("API start failed: {e}");
            }
          }
          Err(e) => {
            eprintln!("Último perfil no válido, mostrando selector: {e}");
          }
        }
      }
      // Si no hay último perfil válido: no arrancar API; la UI muestra /perfiles
      Ok(())
    })
    .on_window_event(|window, event| {
      if let tauri::WindowEvent::Destroyed = event {
        let state = window.app_handle().state::<ApiState>();
        stop_api(&state);
      }
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
