declare global {
  namespace JSX {
    type Element = import("./Element.js").Element

    type ElementType = import("./Element.js").ClosedElementType

    interface IntrinsicAttributes {
      key?: string | number
    }

    type HtmlIntrinsicElements = {
      [Tag in keyof HTMLElementTagNameMap]: import("./Element.js").IntrinsicElementProps<
        HTMLElementTagNameMap[Tag]
      >
    }

    type SvgIntrinsicElements = {
      [Tag in keyof SVGElementTagNameMap]: import("./Element.js").IntrinsicElementProps<
        SVGElementTagNameMap[Tag]
      > &
        import("./Element.js").SvgIntrinsicAttributes
    }

    type SharedIntrinsicTags = Extract<keyof HtmlIntrinsicElements, keyof SvgIntrinsicElements>

    type IntrinsicElements = Omit<HtmlIntrinsicElements, SharedIntrinsicTags> &
      Omit<SvgIntrinsicElements, SharedIntrinsicTags> & {
        [Tag in SharedIntrinsicTags]: HtmlIntrinsicElements[Tag] | SvgIntrinsicElements[Tag]
      } & {
        [Tag in `${string}-${string}`]: import("./Element.js").CustomElementProps
      }

    type LibraryManagedAttributes<C, P> = P
  }
}

export {}
