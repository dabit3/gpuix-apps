import * as rt from '@gpuix/react/jsx-dev-runtime'
import { scaleProps } from './scale'
import { scalesProps } from './components'

export const Fragment = rt.Fragment
export const jsxDEV = (type: any, props: any, ...rest: any[]) => (rt.jsxDEV as any)(type, scalesProps(type) ? scaleProps(props) : props, ...rest)
export type { JSX } from '@gpuix/react/jsx-dev-runtime'
