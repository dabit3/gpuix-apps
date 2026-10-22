import * as rt from '@gpuix/react/jsx-dev-runtime'
import { scaleProps } from './scale'

export const Fragment = rt.Fragment
export const jsxDEV = (type: any, props: any, ...rest: any[]) => (rt.jsxDEV as any)(type, typeof type === 'string' ? scaleProps(props) : props, ...rest)
export type { JSX } from '@gpuix/react/jsx-dev-runtime'
