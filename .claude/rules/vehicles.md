---
paths:
  - "src/poc3d/models/vehicles.ts"
  - "src/poc3d/models/bikes.ts"
  - "src/poc3d/models/ads.ts"
  - "src/poc3d/district/carMix.ts"
  - "src/poc3d/real/adAtlas.ts"
  - "src/poc3d/real/taxiAdLayout.ts"
---

# Vehicle models and which cars where

Covers the car and bike models, lettering and taxi ads, the car mix by district. One of the area docs indexed in the root CLAUDE.md; one topic a paragraph.

`src/poc3d/models/` (reviewed in `models.html`; the vehicles are the district's, the characters not yet): `vehicles.ts` builds cars as lofted bodies with smooth normals, arch cut-outs and details that sit on the skin (sedan, luxury sedan, sports coupe, classic and modern taxi, kei tall-wagon, minivan, kei truck; and `WORK_TYPES` (a showroom row of their own): the work van, kei van, 2 t box truck (cab loft, aluminium box in paint2, `rearLamps` on the frame) and the patrol car (white over black: bonnet, boot and ends black, the cabin's line at mid-door; light bar, gold emblem); a body's loft always has stations at its profile's keys, so coarse detail keeps the silhouette.

**Lettering and ads** (`addVehicleMarks`, apart from the body so stamped parked cars get them per car; `marks` seeds them): taxis' photo ads (`taxiAdFor`, ~60% of taxis; the demo leaves out the love hotel's; the taxi ad atlas's layout is pure, `real/taxiAdLayout.ts`, so the workers place them), work vehicles' invented companies (`WORK_LIVERIES`, `liveryOf`; some plain), the patrol car's 警視庁 and yellow POLICE on its doors and its unit on the roof. Text is a decal (sign style 3: only the letters, cut out) in the sign atlas (`vehicleTexts` is in `signTexts`); parked taxis' photo ads are a chunk mesh of their own (`taxiAds`, kit material from `AdAtlas(TAXI_ADS)`), and traffic's are children of each vehicle (`TrafficSigns`); and for racing, `SPORT_TYPES`: the coupe, an 80s light hatchback `hatch` with panda two-tone, a rotary coupe `rotary`, a turbo AWD coupe `awd`, a kei roadster `roadster`; design flags `popups` (raised pop-up lamps), `wing` (lip / hoop / gt), `hoodVent`, `softTop`, `twoTone`), taxi ads (roof lightbox and door wrap with text through the sign system), night head and brake lights, and `vehicleLights()` for the lightmap. `bikes.ts` builds scooter, motorcycle and delivery scooter. Photo taxi ads: `models/ads.ts` is the catalogue (copy, colours, art name); `assets/ads/` holds the crops made by `scripts/crop_ads.py` from the VN generator's portraits (square roof, 3:4 door); `real/adAtlas.ts` composites photo + copy at runtime into one atlas (lightbox roof panels glow at night, door wraps are print). `characters.ts` loads the modelled cast (see Characters below). New model designs are approved in the showroom before they go into the district.

**Which cars where** (`district/carMix.ts`, pure): weights by model per district (`DISTRICT_CARS`), a zone's own with `cars:` in its file (carried in its style, `DistrictStyle3.cars`; Love District, Host Street, Skyscraper Row, the heights, the port's nightlife and the danchi have theirs), `CITY_CARS` elsewhere; `pickCar(mix, seed)` gives the model and paint. Parked cars take the cell's mix (`Prop.car`, `paint`), each traffic car the mix where it starts (`TrafficSystem`'s `mixAt`: models shared per model and paint, `detail` 0.12, brake lights from `addVehicle`'s `brake` builder, wheels from `wheelLayout`), the expressway `CITY_CARS`. `tests/cars.test.ts`.
