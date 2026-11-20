/** Pinned so the one-click download stays reproducible. */
export const LLAMA_TAG = 'b12359';
export const LLAMA_ZIP_NAME = 'llama-b12359-bin-win-vulkan-x64.zip';
export const LLAMA_ZIP_URL = `https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_TAG}/${LLAMA_ZIP_NAME}`;
export const LLAMA_ZIP_SHA256 = 'e8d18c6e4210cca87e7307c2ea78363ac8d158e4e1397358ec96ab70b53a0d5e';

export const MODEL_REPO = 'Qwen/Qwen3-VL-8B-Instruct-GGUF';
export const MODEL_FILE = 'Qwen3VL-8B-Instruct-Q4_K_M.gguf';
export const MMPROJ_FILE = 'mmproj-Qwen3VL-8B-Instruct-F16.gguf';
export const HF_BASE = `https://huggingface.co/${MODEL_REPO}/resolve/main`;

export const MODEL_LABEL = 'Qwen3-VL 8B Instruct';
export const LLAMA_PORT = 11435;
export const MAX_PAGES = 3;
export const MAX_IMAGES = 12;

export const MODEL_MIN_BYTES = 1_000_000_000;
export const MMPROJ_MIN_BYTES = 50_000_000;
