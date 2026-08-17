# Architecture diagrams

These PlantUML files are the editable source for the architecture visuals embedded in the public developer documentation. The generated SVGs are deployment assets in [`../public/diagrams/`](../public/diagrams/); update them in the same change as their source.

From this directory, regenerate the visuals with:

```sh
plantuml -tsvg -o ../public/diagrams *.puml
```

The sources describe runtime and package boundaries, not public API schemas. Contracts, catalogs, implementation, and tests remain authoritative when a diagram or page needs updating.
