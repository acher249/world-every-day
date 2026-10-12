# Art direction

Status: working guide  
Last updated: 2026-10-12

This document contains the evolving visual rules for generating a daily world.
They belong here—and eventually in versioned pipeline configuration—rather than
in the project introduction.

## Intent

Each edition should become a coherent, playful, diagrammatic world made from
physical elements inspired by the selected stories. It should feel like one
place to explore, not a collage of unrelated illustrations.

The generated image is an intermediate artwork and the visual foundation for the
3D world. The world model interprets that image rather than reproducing exact
geometry, so the composition should favor subjects that remain recognizable when
translated into space.

## Visual grammar

- **Object-led:** Represent stories through recognizable physical subjects that
  can survive reconstruction into 3D.
- **Spatially coherent:** Arrange those subjects as one navigable environment,
  with clear foreground, middle ground, background, paths, and landmarks.
- **Sculptural and legible:** Favor strong silhouettes, distinct forms, readable
  materials, and meaningful differences in scale over tiny surface detail.
- **Grounded but interpretive:** Use visual metaphor where necessary without
  presenting speculation as a literal record of an event.
- **Human-free by default:** Avoid people, faces, crowds, portraits, and
  human-centered scenes. Include animals, ecosystems, tools, architecture, and
  scientific forms when they are essential to the story.
- **Quietly cinematic:** Create a sense of wonder and discovery without the
  visual language of advertising, spectacle, or clickbait.

## Composition

Begin with two anchor stories, three supporting subjects, and five discoverable
environmental details. These are compositional roles, not judgments about a
story's human importance.

Every selected story should remain discoverable through the interface even when
its visual prominence is small. Prefer one unifying setting with navigable depth
over separate panels or isolated scenes.

## Avoid

- text embedded in the generated image
- logos, flags, news layouts, and interface elements
- photographic portraits, faces, and dense crowds
- fragile details that are unlikely to survive world generation
- disconnected vignettes that do not read as one environment
- visual metaphors that could be mistaken for documentary evidence

Context, citations, and explanation belong in the interactive layer. The world
should remain spacious, coherent, and open to exploration.

## Pipeline contract

The image-generation prompt should combine this shared visual grammar with the
day's selected stories, their compositional roles, their proposed physical
representations, and a unifying environment.

Store the structured art direction, final prompt, provider, model identifier,
settings, output, and visual-language version with each edition. This makes the
process reproducible and allows the art direction to evolve without rewriting
the history of earlier worlds.
