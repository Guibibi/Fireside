export function isOperatorOrAdminRole(role: string | null | undefined): boolean {
  return role === "operator" || role === "admin";
}
