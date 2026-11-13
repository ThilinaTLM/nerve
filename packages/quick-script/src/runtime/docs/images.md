# Image transforms

`image(handle)` is a chain; bytes stay on the host. Steps build operations (crop runs before resize); `info()` and `save(name)` execute. Handles: `sdk.docs("files/handles")`. Images for Confluence pages (formats, width): `sdk.docs("confluence/writing")`.

```ts
const small = await image("./shot.png")
  .resize({ width: 760 })
  .png()
  .save("shot-760.png");
```
