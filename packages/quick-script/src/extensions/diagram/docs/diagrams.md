# Diagrams

`diagram.render` sends the source (max {{limit:diagram.source}}) to the configured Kroki server and returns a PNG artifact. Use short labels and vertical layouts (`flowchart TB`) with few nodes per row, so the PNG stays readable at page width. Page image rules: `sdk.docs("confluence/writing")`.

```ts
const flow = await diagram.render({
  type: "mermaid",
  source: "flowchart TB\n  A[Plan] --> B[Ship]",
  name: "flow.png",
});
const { width } = await image(flow).info();
```
