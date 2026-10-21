import { expect, test } from 'bun:test'
import { canManageDiscounts, createSession, verify } from '../src/auth'

test('expired sessions are rejected', () => {
  expect(verify(createSession('u1', 'customer', -1))).toBeNull()
})

test('only staff and admin manage discounts', () => {
  expect(canManageDiscounts({ userId: 'u', role: 'customer', expiresAt: 0 })).toBe(false)
  expect(canManageDiscounts({ userId: 'u', role: 'staff', expiresAt: 0 })).toBe(true)
})
