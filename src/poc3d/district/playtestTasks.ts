/**
 * The playtest's things to try (district/playtest.ts shows them): every one optional, in any order. This file is the
 * only place to edit when the game changes: add, reword or drop a task here. `go` is where "Take me there" puts
 * you (a place is a spawn node id from the stamps, so a renamed one shows as a toast, not a crash); `page` opens one
 * of the other pages in a new tab. Keep each text to what a first-timer needs to see the thing.
 */
export type SeasonKey = 'spring' | 'tsuyu' | 'summer' | 'heat' | 'typhoon' | 'autumn' | 'winter';

export interface TaskGo {
  /** A spawn node's id (`bar_kanpai.out`). */
  readonly place?: string;
  /** The time of day, "HH:MM". */
  readonly time?: string;
  readonly weather?: 'clear' | 'rain' | 'fog' | 'snow';
  readonly season?: SeasonKey;
}

export interface Task {
  /** Stable, never reused: ticks are saved under it. */
  readonly id: string;
  readonly title: string;
  readonly text: string;
  readonly go?: TaskGo;
  /** Another page of the game (relative), opened in a new tab. */
  readonly page?: string;
}

export interface TaskGroup {
  readonly title: string;
  readonly blurb?: string;
  readonly tasks: readonly Task[];
}

export const TASK_GROUPS: readonly TaskGroup[] = [
  {
    title: 'The city, as it looks',
    blurb: 'Nothing to do but stand and look. Open the debug menu (the ` key) and change the sky under yourself.',
    tasks: [
      { id: 'look_crossing_rain', title: 'Kaburo Crossing, a rainy night', text: 'The neon district at its best. Look up, look down the avenues, watch the puddles.', go: { place: 'kaburo_crossing.view', time: '22:00', weather: 'rain' } },
      { id: 'look_times', title: 'One street, all day', text: 'Debug menu → Time & weather: step through dawn, day, dusk and night. Then Light & sky for the moon and the light.', go: { place: 'kaburo_crossing.view', weather: 'clear' } },
      { id: 'look_seasons', title: 'The four seasons', text: 'Debug menu → Time & weather → Season: spring, the rainy season, summer, autumn, winter. Winter brings snow; try the snow-cover buttons.', go: { place: 'kaburo_inari.gate' } },
      { id: 'look_typhoon', title: 'A typhoon', text: 'Season → typhoon. Wind, rain and a darkened sky; walk or drive through it.', go: { place: 'kaburo_crossing.view', season: 'typhoon' } },
      { id: 'look_fog', title: 'Fog', text: 'Weather → fog, or the sliders under Rain, wind and fog.', go: { place: 'yokocho.street', weather: 'fog', time: '23:30' } },
      { id: 'look_ascii', title: 'The ASCII look', text: 'Debug menu → Graphics: the ASCII overlay (vibe, heavy, full) over the same scene, and bloom.', go: { place: 'kaburo_crossing.view', time: '22:00' } },
    ],
  },
  {
    title: 'Walk around',
    blurb: 'WASD walk, Shift run, Space jump, E use or talk, Q third person, J smoke, C squat, F fly.',
    tasks: [
      { id: 'walk_yokocho', title: 'Hoshikuzu Yokocho', text: 'The narrow lantern alleys. People drink, smoke and pass; E on a door.', go: { place: 'yokocho.street', time: '22:00' } },
      { id: 'walk_shrine', title: 'Kaburo Inari Shrine', text: 'A quiet shrine between the towers.', go: { place: 'kaburo_inari.gate' } },
      { id: 'walk_asagiri', title: 'Asagiri', text: 'The next district over, by the elevated line.', go: { place: 'asagiri_station.exit', time: '17:30' } },
      { id: 'walk_denko', title: 'Denkō-chō, the electric town', text: 'Arcades, idols, maid cafés, crowds.', go: { place: 'game_tower.front', time: '19:00' } },
      { id: 'walk_third', title: 'See Mack', text: 'Press Q for third person. He walks, runs, jumps and smokes (J), crouches (C). His face is always in shadow. The debug menu’s Player tab has his wardrobe.', go: { place: 'kaburo_crossing.view' } },
      { id: 'walk_crowd', title: 'The crowd', text: 'Debug menu → People: how many are out, and the people in the windows above. Stand at the crossing at different hours.', go: { place: 'kaburo_crossing.view', time: '18:30' } },
      { id: 'walk_fly', title: 'Fly over it', text: 'Press F, then Space to rise. Fly up high and look at the size of it.', go: { place: 'the_peak.front', time: '17:00', weather: 'clear' } },
    ],
  },
  {
    title: 'Go inside',
    blurb: 'Walk-in places. Stand at a door and press E.',
    tasks: [
      { id: 'in_bath', title: 'Sakura-yu, the public bath', text: 'A neighbourhood sentō.', go: { place: 'sakura_yu.front' } },
      { id: 'in_dept', title: 'Toto Department Store', text: 'Floors, a food hall in the basement, a rooftop garden.', go: { place: 'totochuo_dept.front', time: '14:00' } },
      { id: 'in_rouge', title: 'Hotel Rouge', text: 'The love-hotel lobby, and the floors above.', go: { place: 'hotel_rouge.front', time: '23:00' } },
      { id: 'in_peak', title: 'The Peak penthouse', text: 'The CEO’s tower, up to the roof terrace.', go: { place: 'the_peak.front', time: '21:00' } },
      { id: 'in_bar', title: 'Bar Kanpai', text: 'A small bar with Mama-san behind it.', go: { place: 'bar_kanpai.out', time: '23:00' } },
      { id: 'in_homes', title: 'Where people live', text: 'The detective’s flat in Kōpo Kawabata; the salaryman’s room in Nishihara Danchi.', go: { place: 'kopo.front', time: '20:00' } },
      { id: 'in_shops', title: 'Shops', text: 'Look through shop windows at night; go in the Yoru Mart.', go: { place: 'yoru_mart.front', time: '23:30' } },
      { id: 'in_hospital', title: 'Kasumi General Hospital', text: 'Lobby, ward and basement.', go: { place: 'hospital.front', time: '10:00' } },
    ],
  },
  {
    title: 'Get around',
    blurb: 'Your own car is in the Yotaka Garage. Taxis (H), trains and buses work like the real thing.',
    tasks: [
      { id: 'go_car', title: 'Drive your car', text: 'Go to the garage, find the car in the middle bay, E to take the wheel. Q cycles cameras (cockpit, bonnet, bumper, chase), Z looks back, F headlights. Radio: , . and / at the wheel.', go: { place: 'city_garage.front', time: '22:00' } },
      { id: 'go_crash', title: 'Crash on purpose', text: 'Crash damage is off for you. Debug menu → Player → Car turns it on to see the dents, smoke and the damage readout.', go: { place: 'city_garage.front' } },
      { id: 'go_cars', title: 'Try another car', text: 'Debug menu → Player → Car lists every car you can own; picking one swaps it in at once.', go: { place: 'city_garage.front' } },
      { id: 'go_taxi', title: 'Hail a taxi', text: 'Press H on a street. Pick where to go and watch the ride.', go: { place: 'kaburo_crossing.view' } },
      { id: 'go_subway', title: 'Ride the subway', text: 'Press E at a station, pick a stop. Platforms, trains and an announcer.', go: { place: 'totochuo_station.exit' } },
      { id: 'go_elevated', title: 'The elevated Tōto Line', text: 'Take the train along the viaduct, and walk about in the carriage.', go: { place: 'kaburo_station.exit' } },
      { id: 'go_bus', title: 'Take a bus', text: 'Wait at the rotary; E to board.', go: { place: 'west_exit.plaza', time: '09:00' } },
      { id: 'go_gps', title: 'Use the map and GPS', text: 'M opens the map: pick a destination and follow the route (chevrons on the road, the phone’s Maps app). Hold N while driving to let the car drive itself.', go: { place: 'kaburo_crossing.view' } },
      { id: 'go_expressway', title: 'The Tōto Expressway', text: 'Take an on-ramp (the map shows them) and drive the loop above the city.', go: { place: 'ebisu_pa.front', time: '23:30' } },
      { id: 'go_race_city', title: 'Race on the expressway', text: 'Talk to the racer at Ebisu-jima PA (E) for a challenge. Or Debug menu → World → Races.', go: { place: 'ebisu_pa.front', time: '23:30' } },
      { id: 'go_chase', title: 'A car chase', text: 'Debug menu → World → chases. Gunmen come after you; look back to see them in the mirror.', go: { place: 'city_garage.front' } },
    ],
  },
  {
    title: 'Race',
    blurb: 'Separate pages with their own tracks. They open in a new tab.',
    tasks: [
      { id: 'race_page', title: 'The race venues', text: 'Mountain passes, the wharf, a street circuit: time trials, drift attack, battles.', page: 'race.html' },
      { id: 'race_garage', title: 'The garage', text: 'Your cars, paint, livery, neon and tuning.', page: 'garage.html' },
    ],
  },
  {
    title: 'Phone, radio, story',
    blurb: 'Tab opens the phone: messages, Maps, weather, music, saves.',
    tasks: [
      { id: 'phone_open', title: 'The phone', text: 'Tab. Messenger, Maps, Weather, Music, and where saves are.', go: { place: 'kaburo_crossing.view' } },
      { id: 'phone_kaiwa', title: 'The messenger', text: 'KAIWA has a welcome message waiting.' },
      { id: 'story_mama', title: 'Talk to Mama-san', text: 'A story scene at Bar Kanpai: E on her at the counter.', go: { place: 'bar_kanpai.out', time: '23:00' } },
      { id: 'story_people', title: 'Talk to someone else', text: 'Anyone with a name tag at E range has something to say; try the arcade regular, the doorman, the staff at the halls.', go: { place: 'game_tower.front', time: '19:00' } },
      { id: 'radio_listen', title: 'Listen to the radio', text: 'Get in your car and tune with , and . — the stations broadcast on the clock, jazz and city pop. Phone → Music for the player.', go: { place: 'city_garage.front', time: '23:00' } },
      { id: 'sleep', title: 'Sleep through a night', text: 'The futon in Kōpo Sakura 203 (yours): E to sleep until morning. Or T to wait out time anywhere.', go: { place: 'kopo_sakura.mc_home', time: '23:00' } },
    ],
  },
  {
    title: 'Places worth the trip',
    blurb: 'Each is a landmark. Take the car, the train or the taxi, or just the button.',
    tasks: [
      { id: 'trip_tower', title: 'Tōto Tower and the city from above', text: 'Look at the grid from the top; the observatory at City Hall is 172 m up.', go: { place: 'city_hall.observatory', time: '20:00' } },
      { id: 'trip_lookout', title: 'Takanodai Lookout', text: 'The hills, and the villa on the heights.', go: { place: 'takanodai_lookout.rail', time: '19:30' } },
      { id: 'trip_port', title: 'The port', text: 'Container cranes, the fish market, the ferry, the sky wheel.', go: { place: 'quay_cranes.front', time: '05:30' } },
      { id: 'trip_wonder', title: 'Suidō Wonderland', text: 'A funfair with a coaster.', go: { place: 'wonderland.front', time: '20:00' } },
      { id: 'trip_dome', title: 'Tōto Dome and Bay Hall', text: 'The big concert venues.', go: { place: 'dome.front', time: '19:00' } },
      { id: 'trip_airport', title: 'Tōto Airport', text: 'Terminal, control tower, the airport station.', go: { place: 'airport.front', time: '09:00' } },
      { id: 'trip_danchi', title: 'Nishihara Danchi', text: 'Postwar housing blocks out toward the edge of town.', go: { place: 'nishihara_danchi.front', time: '16:30' } },
    ],
  },
  {
    title: 'Behind the scenes',
    blurb: 'The showrooms where the models are made and reviewed. They open in a new tab.',
    tasks: [
      { id: 'show_cars', title: 'Cars, bikes and props', text: 'Orbit and fly around every vehicle, with lighting and wireframe options.', page: 'models.html' },
      { id: 'show_mob', title: 'The passers-by', text: 'The crowd figures: bodies, outfits, poses.', page: 'mob.html' },
      { id: 'show_cast', title: 'The cast', text: 'Named characters.', page: 'characters.html' },
      { id: 'show_fight', title: 'The fight yard', text: 'A test yard for the melee: fists, katana, bat. Number keys pick the weapon, click to strike. Not in the city yet.', page: 'fight.html' },
    ],
  },
];

export const TASK_COUNT = TASK_GROUPS.reduce((n, g) => n + g.tasks.length, 0);
