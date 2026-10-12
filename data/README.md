# Waypoint library

> The files in this folder were published by the clubs and organisers who made them.
> They are included so the library works out of the box and are **not** covered
> by the VTasker licence; see [NOTICE](../NOTICE).

The waypoint library in the app is built from this folder. Adding a region, an
area or a new waypoint set means dropping files in — no code changes, no list to
update.

## Layout

Three levels: **region / area / files**.

```
data/
  New Zealand/                      <- region: a heading in the library
    Auckland_Region/                <- area: a collapsible folder under it
      Auckland_Competition_Waypoints_2016.gpx   <- one dataset
      Kariotahi_Waypoints.gpx                   <- another dataset
      Kario_Ridge_Race_2015.gpx                 <- another
    Nelson_Tasman_Region/
      45th_NZ_HG_Nationals_2023.SeeYou.cup      }
      45th_NZ_HG_Nationals_2023.CompeGPS.wpt    }  ONE dataset, four formats
      45th_NZ_HG_Nationals_2023.FS.wpt          }
      45th_NZ_HG_Nationals_2023.GPX.gpx         }
      Nelson_Competition_Waypoints_2021.gpx     <- a separate dataset
  Australia/                        <- add a folder, get a new region
    Corryong/
      corryong.cup
```

- **First level = region.** New Zealand, Australia, France — whatever grouping
  makes sense. Sorted alphabetically.
- **Second level = area.** Becomes a collapsible folder in the library, with a
  badge showing how many sets it holds (or how many are switched on).
- **Third level = the files themselves.** Each distinct waypoint set becomes one
  tickbox.

Underscores display as spaces, so `Nelson_Tasman_Region` reads as
"Nelson Tasman Region".

## Several sets in one area folder

An area folder normally holds a mix: a few different waypoint sets, some of them
published in several formats at once, alongside PDFs and other documents.

Files are grouped into datasets by their **base name** — the filename with the
extension and any format marker removed. These markers are recognised:

`.SeeYou` `.CompeGPS` `.FS` `.GPX` `.GoogleEarth` `.UTM` `.KML` `.Garmin` `.OziExplorer`

So `45th_NZ_HG_Nationals_2023.SeeYou.cup` and `45th_NZ_HG_Nationals_2023.FS.wpt`
collapse into one dataset labelled "45th NZ HG Nationals 2023", while
`Kariotahi_Waypoints.gpx` stays separate. Datasets are listed newest-year-first
where the name contains a year, otherwise alphabetically.

Anything that isn't a readable waypoint file — PDFs, KML, XLSX, images — is
ignored, so you can drop a whole competition download in unedited.

## File formats

Supported: `.cup` (SeeYou), `.gpx`, `.csv`, `.wpt`.

Where a set exists in several formats only **one** file is read, chosen in this
order:

1. `.cup` — carries codes, place names and elevations, and is the most
   consistently exported
2. `.gpx` — place names are read from `<cmt>`/`<desc>`, the code from `<name>`
3. `.csv`
4. `.wpt` — last, because the extension covers several incompatible formats
   (this data has both CompeGPS and FS files claiming it)

Keeping the spare formats costs nothing at runtime — only the chosen file is
ever downloaded. They *are* emitted into `dist/` as unused chunks though, so
delete them if you want a leaner deploy.

## Avoid duplicate sets

Two files holding the same points appear as two tickboxes, which is just noise.
Before adding a set, check whether the area already has it under another name.

## After adding files

Run `npm run build` (or restart `npm run dev`). The folder tree is read at build
time, so new files need a rebuild to appear.

Nothing is downloaded by the browser until a pilot actually ticks a dataset —
each file is emitted as its own chunk.

## How it works

`lib/waypointCatalogue.ts` scans this tree with Vite's `import.meta.glob` and
builds the region/area/dataset list that `components/WaypointLibraryPanel.tsx`
renders. Parsers live in `utils/parsers.ts`; each takes an id prefix naming the
dataset, so sets that reuse codes (A01, W07…) don't collide when several are
switched on at once.
