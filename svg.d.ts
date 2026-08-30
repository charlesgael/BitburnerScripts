// `plugin/svg-to-react.ts` turns every `src/ui/svg/*.svg` file into a React
// component at load time (see that file's header comment) rather than
// leaving Vite's default asset behavior in place (a URL string — see
// `vite/client`'s own `declare module '*.svg'`, which this declaration
// deliberately overrides project-wide: only one of the two can be true for
// a given specifier, and every `.svg` under this project is meant to be a
// component, never a URL).
declare module '*.svg' {
  // `props` (any, matching `AppComponentProps.React` and friends elsewhere
  // in this codebase — see CLAUDE.md) is spread onto the root `<svg>`,
  // overriding the `width`/`height: '1em'` the plugin forces by default —
  // pass e.g. `className`/`style`/`width`/`height` same as any other
  // component.
  const Component: (props?: any) => JSX.Element
  export default Component
}
