import { getHealth } from '@ghar/contracts'
import { route } from '@/lib/api/handler'

export const GET = route(getHealth, () => ({ status: 'ok', time: new Date().toISOString() }))
