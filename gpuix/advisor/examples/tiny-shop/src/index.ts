import { handle } from './api/routes'

export default { port: Number(process.env.PORT ?? 3000), fetch: handle }
