import * as rt from '@gpuix/react/jsx-runtime'
import { scaleProps } from './scale'
import { scalesProps } from './components'

export const Fragment = rt.Fragment
const wrap = (fn: (...a: any[]) => any) => (type: any, props: any, ...rest: any[]) => fn(type, scalesProps(type) ? scaleProps(props) : props, ...rest)
export const jsx = wrap(rt.jsx)
export const jsxs = wrap(rt.jsxs)
export type { JSX } from '@gpuix/react/jsx-runtime'
