export type SnackbarKind = "info" | "error";

export const snackbar = $state({
  open: false,
  message: "",
  kind: "info" as SnackbarKind,
});

let timer: ReturnType<typeof setTimeout> | undefined;

export function showSnackbar(
  message: string,
  timeout = 5000,
  kind: SnackbarKind = "info",
): void {
  snackbar.message = message;
  snackbar.kind = kind;
  snackbar.open = true;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    snackbar.open = false;
    timer = undefined;
  }, timeout);
}

export function hideSnackbar(): void {
  if (timer) clearTimeout(timer);
  timer = undefined;
  snackbar.open = false;
}
