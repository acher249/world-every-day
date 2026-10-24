# Art direction

Status: working guide  
Last updated: 2026-10-13

This document contains the evolving visual rules for generating a daily world.
They belong here—and eventually in versioned pipeline configuration—rather than
in the project introduction.

## Intent

Each edition should become a coherent, playful, diagrammatic world made from
physical elements inspired by the selected stories. It should feel like one
place to explore, not a collage of unrelated illustrations.

Diagrammatic describes the world's clarity and organization, not a flat or
cartoon visual style. The environment should retain grounded cinematic realism,
believable materials, atmospheric depth, and an expansive scale that feels
inhabitable rather than miniature.

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

Compose for a visitor standing near the center of a spherical environment, not
for a single forward-facing hero image. Story landmarks occupy separate azimuth
sectors around the full 360-degree turn. Anchors should be far apart, supporting
subjects should fill other major directions, and smaller details should sit in
the gaps. The initial view may introduce the world, but visitors should need to
look left, right, and behind to find the complete edition.

Keep the camera near standing eye height, approximately 1.7 meters above the
walking surface. Place recognizable landmark mass in a comfortable equatorial
interaction band with grounded bases below the horizon. Use varied walkable
distances to create a spacious sequence of discoveries around an open
orientation zone. Give each landmark its own bay, readable silhouette, grounded
base, and visible interval before the next subject. Avoid bird's-eye staging,
immediate foreground objects, shared display platforms, overlapping subjects,
and clusters that put several hotspots in the same viewing direction.

The panorama prompt starts and ends with a critical level-horizon check against
the middle pixel row (50% image height). This concerns the geometric horizon,
not mountain ridges or nearby shorelines; varied terrain remains welcome.
This is prompt guidance, not an automatic geometric validation or retry stage.

Use one coherent circulation system to make that distribution legible. Its form
should follow the world: a loop, oval, meander, branching boardwalk, terraced
route, shoreline, or another navigable structure may all work. The circular
path is a useful solution, not a fixed template. Preserve a quiet camera area,
continuous terrain, clear outward sightlines, and distinct landmark addresses
without making every edition spatially identical.

Every primary hotspot has a companion **Landmark Echo** explaining the physical
representation: what visitors are looking at, what the real object or process
does, and how the artwork connects to that idea. Keep this to one or two plain
sentences grounded in supplied story facts, and identify invented sculptures or
metaphors as artwork rather than reported objects. Older editions without this
explanation fall back to their original story summary, labeled as interpretation.
It shares the story's baked
3D anchor and focus bounds, with a small screen-space offset for its badge.
Selecting the companion opens its story panel and dismisses the tooltip;
hovering it does not create a persistent selection.
Use short, literal object names, not invented technical or poetic titles.
Representations are artwork, not necessarily objects reported in an article.

The interaction layer may also identify several **Story Echoes**:
secondary environmental details that reveal how a story shaped the world, such
as terrain, material, or ecological traces. An echo must be visibly separate
from its story's primary landmark, grounded in the supplied story details, and
omitted whenever the connection is uncertain. Aim for six to eight echoes from
different stories when the generated environment supports them.
Selecting a standalone echo or its tooltip moves the camera to its related
story without opening the story panel. Landmark tooltips remain highlighted
while hovered and can be selected to open the story panel.

## Avoid

- text embedded in the generated image
- logos, flags, news layouts, and interface elements
- photographic portraits, faces, and dense crowds
- fragile details that are unlikely to survive world generation
- disconnected vignettes that do not read as one environment
- conventional hero compositions that cluster the stories in front of the camera
- visual metaphors that could be mistaken for documentary evidence

Context, citations, and explanation belong in the interactive layer. The world
should remain spacious, coherent, and open to exploration.

## Landmark surface checks

During baking, bounded landmarks use a 5×5 ray grid plus the detected target.
The baker prefers the nearest depth band supported by neighboring samples,
rejects isolated hits, and places the anchor on an actual sampled surface.
This helps avoid shooting through arches or rings into the background. If no
supported surface is found, baking fails rather than inventing a position.
Unbounded legacy targets retain single-ray behavior. This is a geometric
heuristic, not proof of object identity; foreground clutter or an inaccurate
box can still require detection review. All sampling happens during baking,
not in the viewer's render loop.

## Pipeline contract

The image-generation prompt should combine this shared visual grammar with the
day's selected stories, their compositional roles, their proposed physical
representations, and a unifying environment.

Store the structured art direction, final prompt, provider, model identifier,
settings, output, and visual-language version with each edition. This makes the
process reproducible and allows the art direction to evolve without rewriting
the history of earlier worlds.
