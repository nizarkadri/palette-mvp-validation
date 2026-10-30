import { createSemaphore } from "./semaphore.js";

export const providerSemaphore = createSemaphore(2, { name: "provider" });
export const renderSemaphore = createSemaphore(1, { name: "render" });
