import { useMutation } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

export type AutosaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'invalid' | 'error';

export interface AutosaveOptions<T> {
  value: T;
  save: (value: T) => Promise<unknown>;
  /** Devuelve los problemas que impiden guardar (vacío = válido). */
  validate?: (value: T) => string[];
  /** false mientras no se hayan cargado los datos del servidor. */
  enabled?: boolean;
  delay?: number;
  errorTitle?: string;
}

/**
 * Guarda `value` con debounce cuando difiere de la última versión persistida.
 * `reset(v)` fija esa versión (p. ej. al cargar del servidor) sin guardar; `null` = nada persistido aún.
 */
export function useAutosave<T>({
  value,
  save,
  validate,
  enabled = true,
  delay = 600,
  errorTitle,
}: AutosaveOptions<T>) {
  const serialized = JSON.stringify(value);
  const persistedRef = useRef<string | null | undefined>(undefined);
  const latestRef = useRef({ value, serialized, save, validate });
  latestRef.current = { value, serialized, save, validate };
  const chainRef = useRef<Promise<unknown>>(Promise.resolve());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef(false);
  const [status, setStatus] = useState<AutosaveStatus>('idle');
  const [problems, setProblems] = useState<string[]>([]);
  const [epoch, setEpoch] = useState(0);

  const mutation = useMutation({
    mutationFn: (v: T) => latestRef.current.save(v),
    meta: { errorTitle },
  });
  const mutateRef = useRef(mutation.mutateAsync);
  mutateRef.current = mutation.mutateAsync;

  const run = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    pendingRef.current = false;
    const { value: v, serialized: s } = latestRef.current;
    if (s === persistedRef.current) return;
    setStatus('saving');
    chainRef.current = chainRef.current.then(async () => {
      try {
        await mutateRef.current(v);
        persistedRef.current = s;
        if (latestRef.current.serialized === s) setStatus('saved');
      } catch {
        if (latestRef.current.serialized === s) setStatus('error');
      }
    });
  }, []);

  useEffect(() => {
    if (!enabled) {
      // Se desactiva con un guardado en espera (p. ej. cambio de ejercicio): se envía ya.
      if (pendingRef.current) run();
      return;
    }
    if (persistedRef.current === undefined) return;
    if (serialized === persistedRef.current) {
      pendingRef.current = false;
      setProblems([]);
      setStatus((s) => (s === 'invalid' || s === 'pending' ? 'idle' : s));
      return;
    }
    const issues = latestRef.current.validate?.(latestRef.current.value) ?? [];
    setProblems(issues);
    if (issues.length > 0) {
      pendingRef.current = false;
      setStatus('invalid');
      return;
    }
    setStatus('pending');
    pendingRef.current = true;
    timerRef.current = setTimeout(run, delay);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [serialized, enabled, delay, run, epoch]);

  // Al salir de la pantalla no se pierde lo que quedaba pendiente.
  useEffect(
    () => () => {
      if (pendingRef.current) run();
    },
    [run],
  );

  const reset = useCallback((v: T | null) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    pendingRef.current = false;
    persistedRef.current = v === null ? null : JSON.stringify(v);
    setProblems([]);
    setStatus('idle');
    setEpoch((e) => e + 1);
  }, []);

  return { status, problems, reset };
}
