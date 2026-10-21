export type Role = 'customer' | 'staff' | 'admin'
export interface Session { userId: string; role: Role; expiresAt: number }

const sessions = new Map<string, Session>()

export function createSession(userId: string, role: Role, ttlMs = 60 * 60 * 1000): string {
  const token = crypto.randomUUID()
  sessions.set(token, { userId, role, expiresAt: Date.now() + ttlMs })
  return token
}

// Invariant: an expired session is never accepted, and only staff/admin may create discount codes.
export function verify(token: string | null): Session | null {
  if (!token) return null
  const s = sessions.get(token)
  if (!s || s.expiresAt <= Date.now()) return null
  return s
}

export function canManageDiscounts(s: Session): boolean {
  return s.role === 'staff' || s.role === 'admin'
}
