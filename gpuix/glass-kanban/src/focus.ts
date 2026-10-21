// Tracks whether a text field owns the keyboard, so single-key shortcuts stay out of the way.
let focused = 0;
export const textFocus = {
  onFocus: () => {
    focused++
  },
  onBlur: () => {
    focused = Math.max(0, focused - 1)
  },
  active: () => focused > 0,
  reset: () => {
    focused = 0
  },
}
