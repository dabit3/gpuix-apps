import { applyDiscount, type Cart } from '../cart'
import { canManageDiscounts, verify } from '../auth'
import { placeOrder } from '../orders'

const codes = new Map<string, number>([['WELCOME10', 10]])

export async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const session = verify(req.headers.get('authorization'))
  if (!session) return new Response('unauthorized', { status: 401 })

  if (req.method === 'POST' && url.pathname === '/v1/discounts') {
    if (!canManageDiscounts(session)) return new Response('forbidden', { status: 403 })
    const { code, percent } = (await req.json()) as { code: string; percent: number }
    codes.set(code, percent)
    return Response.json({ code, percent }, { status: 201 })
  }

  if (req.method === 'POST' && url.pathname === '/v1/orders') {
    const { cart, code } = (await req.json()) as { cart: Cart; code?: string }
    const discounted = code ? applyDiscount(cart, codes.get(code) ?? 0) : cart
    return Response.json(placeOrder(session.userId, discounted), { status: 201 })
  }

  return new Response('not found', { status: 404 })
}
