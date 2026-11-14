# Image generation

`imagegen.generate` creates one new image and returns an artifact handle; the extension (`.png`, `.jpg`, `.webp`) follows what the backend returned. It spends the user's credit at the backend: generate once, check the result, and do not loop. `sdk.describe("imagegen")` shows the configured backend, its defaults and its `backendOptions`.

```ts
const hero = await imagegen.generate({
  prompt: "Isometric server rack, flat colours",
  size: "1536x1024",
  name: "hero.png",
});
await image(hero).resize({ width: 760 }).save("hero-760.png");
```

- `size`: `"auto"` or `"<width>x<height>"`; the limits are in the error when a size is refused.
- `inputs`: reference images as file handles, for backends that take them. The error names the backend when it does not.
- `backendOptions`: options only the configured backend has; unknown ones are rejected with the valid names.
- To look at the result, `read` the artifact path or use `explain_image`. Image rules for pages: `sdk.docs("confluence/writing")`.
