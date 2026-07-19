# desktop_markdown_rendering v4

Payloads, splits, feedback sampling, and performance metrics are unchanged from v3. The scorer now
canonicalizes adjacent assistant render roots as continuous visible text before hashing. This
removes an artificial React-component-boundary delimiter, so changing internal Markdown block
grouping cannot fail expanded-content equivalence when the actual rendered text is unchanged.
