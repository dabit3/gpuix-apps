import { Button, motion, Select, SelectContent, SelectItem, SelectTrigger, Tooltip, TooltipContent } from '@gpuix/react'

const COMPONENTS = new Set<unknown>([Button, motion.div, Select, SelectContent, SelectItem, SelectTrigger, Tooltip, TooltipContent])

export const scalesProps = (type: unknown) => typeof type === 'string' || COMPONENTS.has(type)
