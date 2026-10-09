# The animation library: where it came from

`ual1.glb`, `ual1rm.glb` and `ual2.glb` are cut from **Universal Animation Library** (the whole pack: its paid tier)
and **Universal Animation Library 2** (the free Standard pack) by **Quaternius** (https://quaternius.com). Each
pack's own `License.txt`, the paid one's too, reads:

> License:
> CC0 1.0 Universal (CC0 1.0)
> Public Domain Dedication
> https://creativecommons.org/publicdomain/zero/1.0/

and the packs' pages say "Free to use in personal, educational and commercial projects". No credit is owed; it's given
here and in the root `CREDITS.md` anyway.

Pack 1 was bought by the user on 2026-10-06 from the author's itch.io page (its Source tier, $14.99, which has the Pro
tier's exports and the .blend): the zip isn't in the repository and can't be fetched by the build; only what's cut
from it is here. Pack 2 is still the free Standard pack (42 of its 134 clips): its paid tier, which has the sword
combos, hasn't been bought. Pack 2 was fetched 2026-10-06 from the author's own upload on OpenGameArt, marked CC0
there too:

| File | From | Page |
| --- | --- | --- |
| `ual1.glb` | `Universal Animation Library[Source].zip`, `Unreal-Godot/UAL1.glb` (its clips with the root staying put) | https://quaternius.itch.io/universal-animation-library |
| `ual1rm.glb` | the same zip, `Unreal-Godot/UAL1_RM.glb` (the same clips with root motion): five of them, named `_RM` | https://quaternius.itch.io/universal-animation-library |
| `ual2.glb` | `universal_animation_library_2standard.zip`, `Unreal-Godot/UAL2_Standard.glb` | https://opengameart.org/content/universal-animation-library-2 |

## What was done to them (the library's two packs)

`node scripts/anims/build.mjs` (it fetches pack 2 into `.cache/anims/` if it isn't there; pack 1's bought zip has to
be put there by hand, as `universal_animation_library_source.zip`): the mannequin's mesh, materials and textures
removed, leaving the skeleton and the clips; the bones under the Unreal mannequin's names, which the cast's rig uses
(the paid pack 1 and pack 2 already have them, but for `root` and `Head`); the finger-tip and toe-tip helper bones and
every scale track removed; position tracks kept only on the root and the pelvis; rotations stored as 16-bit; the
`A_TPose` reference clip dropped. The motion itself is untouched. In the game each clip is fitted to a character's own
skeleton as it's played (`src/poc3d/models/characterAnims.ts`).

## The clips

`ual1.glb` (119): BackFlip, Celebration, ClimbLedge, Climb_Down_Loop, Climb_Enter, Climb_Exit, Climb_Idle_Loop,
Climb_Left_Loop, Climb_Right_Loop, Climb_Up_Loop, Counter_Angry, Counter_Enter, Counter_Exit, Counter_Give,
Counter_Idle_Loop, Counter_Show, Crawl_Bwd_Loop, Crawl_Enter, Crawl_Exit, Crawl_Fwd_Loop, Crawl_Idle_Loop,
Crawl_Left_Loop, Crawl_Right_Loop, Crouch_Bwd_L_Loop, Crouch_Bwd_Loop, Crouch_Bwd_R_Loop, Crouch_Enter, Crouch_Exit,
Crouch_Fwd_L_Loop, Crouch_Fwd_Loop, Crouch_Fwd_R_Loop, Crouch_Idle_Loop, Crouch_Left_Loop, Crouch_Right_Loop, Crying,
Dance_Loop, Death01, Death02, Dodge_Left, Dodge_Right, Drink, Driving_Loop, Fixing_Kneeling, GroundSit_Enter,
GroundSit_Exit, GroundSit_Idle_Loop, Hit_Chest, Hit_Head, Hit_Shoulder_L, Hit_Shoulder_R, Hit_Stomach,
Idle_LookAround_Loop, Idle_Loop, Idle_Paper, Idle_Rock, Idle_Scissors, Idle_Talking_Loop, Idle_Tired_Loop,
Idle_Torch_Loop, Interact, Jog_Bwd_L_Loop, Jog_Bwd_Loop, Jog_Bwd_R_Loop, Jog_Fwd_L_Loop, Jog_Fwd_LeanL_Loop,
Jog_Fwd_LeanR_Loop, Jog_Fwd_Loop, Jog_Fwd_R_Loop, Jog_Left_Loop, Jog_Right_Loop, Jump_Land, Jump_Loop, Jump_Start,
Kick, PickUp_Kneeling, PickUp_Table, Pistol_Aim_Down, Pistol_Aim_Neutral, Pistol_Aim_Up, Pistol_Idle_Loop,
Pistol_Reload, Pistol_Shoot, PunchKick_Enter, PunchKick_Exit, Punch_Cross, Punch_Jab, Push_Enter, Push_Exit,
Push_Loop, Roll, Sitting_Enter, Sitting_Exit, Sitting_Idle02_Loop, Sitting_Idle03_Loop, Sitting_Idle_Loop,
Sitting_Nodding_Loop, Sitting_Talking_Loop, Spell_Double_Enter, Spell_Double_Exit, Spell_Double_Idle_Loop,
Spell_Double_Shoot_Loop, Spell_Simple_Enter, Spell_Simple_Exit, Spell_Simple_Idle_Loop, Spell_Simple_Shoot,
Sprint_Enter, Sprint_Exit, Sprint_Loop, Swim_Fwd_Loop, Swim_Idle_Loop, Sword_Attack, Sword_Attack_Standing,
Sword_Enter, Sword_Exit, Sword_Idle, Turn90_L, Turn90_R, Walk_Formal_Loop, Walk_Loop

`ual1rm.glb` (5): ClimbLedge_RM, Dodge_Left_RM, Dodge_Right_RM, Roll_RM, Sword_Attack_RM

(The free pack 1 had 45 of these, under the same names but for `Punch_Enter`, which the full pack calls
`PunchKick_Enter`.)

`ual2.glb` (42): Chest_Open, ClimbUp_1m_RM, Consume, Farm_Harvest, Farm_PlantSeed, Farm_Watering, Hit_Knockback,
Hit_Knockback_RM, Idle_FoldArms_Loop, Idle_Lantern_Loop, Idle_No_Loop, Idle_Rail_Call, Idle_Rail_Loop,
Idle_Shield_Break, Idle_Shield_Loop, Idle_TalkingPhone_Loop, LayToIdle, Melee_Hook, Melee_Hook_Rec,
NinjaJump_Idle_Loop, NinjaJump_Land, NinjaJump_Start, OverhandThrow, Shield_Dash_RM, Shield_OneShot, Slide_Exit,
Slide_Loop, Slide_Start, Sword_Block, Sword_Dash_RM, Sword_Regular_A, Sword_Regular_A_Rec, Sword_Regular_B,
Sword_Regular_B_Rec, Sword_Regular_C, Sword_Regular_Combo, TreeChopping_Loop, Walk_Carry_Loop, Yes, Zombie_Idle_Loop,
Zombie_Scratch, Zombie_Walk_Fwd_Loop

# Walks from motion capture: Carnegie Mellon University

`cmu_<subject>.glb` are cut from the **CMU Graphics Lab Motion Capture Database** (http://mocap.cs.cmu.edu), fetched
2026-10-06. Its terms, quoted from its home page and FAQ that day:

> This dataset of motions is free for all uses.

> This data is free for use in research projects. You may include this data in commercially-sold products, but you
> may not resell this data directly, even in converted form. If you publish results obtained using this data, we would
> appreciate it if you would send the citation to your published paper to jkh+mocap@cs.cmu.edu, and also would add
> this text to your acknowledgments section: The data used in this project was obtained from mocap.cs.cmu.edu. The
> database was created with funding from NSF EIA-0196217.

> The motion capture data may be copied, modified, or redistributed without permission.

So: use in a sold game and changes are allowed, there is no clause about what kind of work it goes into, and the one
thing not allowed is selling the motions themselves, converted or not. The site also asks not to be crawled: the
script fetches only the files below.

| Clip | File | Trial | The database's description |
| --- | --- | --- | --- |
| `Walk_Normal_105_Loop` | `cmu_105.glb` | 105_29 | NormalWalk |
| `Walk_CasualQuick_105_Loop` | `cmu_105.glb` | 105_22 | CasualQuickWalk |
| `Walk_Slow_105_Loop` | `cmu_105.glb` | 105_10 | SlowWalk |
| `Walk_12_Loop` | `cmu_12.glb` | 12_01 | walk |
| `Walk_16_Loop` | `cmu_16.glb` | 16_15 | walk |
| `Walk_35_Loop` | `cmu_35.glb` | 35_01 | walk |
| `Walk_38_Loop` | `cmu_38.glb` | 38_01 | walk |
| `Walk_69_Loop` | `cmu_69.glb` | 69_01 | walk forward |
| `Run_09_Loop` | `cmu_09.glb` | 09_01 | run |
| `Run_16_Loop` | `cmu_16.glb` | 16_55 | run |
| `Jog_35_Loop` | `cmu_35.glb` | 35_17 | run/jog |
| `Jog_02_Loop` | `cmu_02.glb` | 02_03 | run/jog |
| `Run_127_Loop` | `cmu_127.glb` | 127_03 | Run |
| `Run_141_Loop` | `cmu_141.glb` | 141_01 | Run |
| `Run_143_Loop` | `cmu_143.glb` | 143_01 | Run |
| `RunStart_127` | `cmu_127.glb` | 127_04 | Walk to Run |
| `RunStart_143` | `cmu_143.glb` | 143_03 | Start to Run |
| `RunStop_127` | `cmu_127.glb` | 127_05 | Run to Quick Stop |
| `RunStop_143` | `cmu_143.glb` | 143_02 | Run to Stop |
| `RunStop_16` | `cmu_16.glb` | 16_57 | run/jog, sudden stop |
| `Jump_16` | `cmu_16.glb` | 16_01 | jump |
| `JumpHigh_16` | `cmu_16.glb` | 16_03 | high jump |
| `JumpForward_16` | `cmu_16.glb` | 16_05 | forward jump |
| `Jump_118` | `cmu_118.glb` | 118_01 | Jump |
| `Jump_13` | `cmu_13.glb` | 13_39 | jump |

Each trial is `http://mocap.cs.cmu.edu/subjects/<subject>/<trial>.amc` with its subject's skeleton
`<subject>.asf`. Subject 105's files say she is a woman (`emotionWalksFemale` in their header); the database doesn't
say who the others are.

## What was done to them

`node scripts/anims/cmu.mjs`: one stride of each trial, left heel to left heel (right to right where a trial is too
short to hold two of the left's: the runs of 09 and 16), the one whose end is most like its start; turned to walk towards +z; the travel taken out, so it walks on the spot; the small gap between its end and
its start spread over the stride, so it loops; sampled at 30 frames a second from the capture's 120; the trunk's
turns counted from the stride's own middle (and its lean from the subject standing still, where the trial has that)
in place of the skeleton's zero pose; the wrist's and toes' own joints, which the site calls noisy, left out (the hand
goes with the forearm, the toes with the foot); the fingers, which weren't captured, left as the character has them.
Bones are under the cast's names. Trials tried and left out, and why, are in the script's header. The clips that aren't loops (the starts and stops of a run, the jumps) are a whole take once through, on the spot: his way over the floor taken out, smoothed over half a second, upright taken from where he stands still in the take. Subjects 141's and 143's files are 60 frames a second, not the 120 the site gives for all, and are read so.

# Runs from motion capture: the 100STYLE dataset

`review/style100.glb` (under review: in a folder the game doesn't take, so nothing of it ships and the root
`CREDITS.md` has no entry for it; **chosen, it moves up a folder and its credit goes into that file's first section,
worded as the author asks below**) is cut from the **100STYLE dataset** by **Ian Mason, Sebastian Starke and Taku Komura**
(https://www.ianxmason.com/100style/), its zip of .bvh files fetched 2026-10-06 from
https://zenodo.org/records/8127870 (`100STYLE.zip`, 1.4 GB; kept in `.cache/100style/`, not in the repository). The
author's page reads:

> This work is licensed under a Creative Commons Attribution 4.0 International License.

and asks, for creative or commercial use, to "credit in an appropriate way. E.g. 'The 100STYLE Dataset - Ian Mason'".
Zenodo's record gives the same licence. So: commercial use and changes are allowed with that credit, and the licence has no clause about the kind of work.
The credit to show if it's used: "Motion capture: The 100STYLE Dataset - Ian Mason (ianxmason.com/100style), licensed
under Creative Commons Attribution 4.0, https://creativecommons.org/licenses/by/4.0/ (cut, looped and retargeted
for this game)".

Twelve styles, each walked, run and stood in (`Walk_<Style>_Loop` from `<Style>/<Style>_FW.bvh`, forwards walking;
`Run_<Style>_Loop` from `<Style>_FR.bvh`, forwards running; `Idle_<Style>_Loop` from `<Style>_ID.bvh`, idling):
Neutral, HandsInPockets, LeanBack, SwingShoulders, ArmsBySide, ArmsBehindBack, ArmsFolded, Strutting, Proud, Heavyset,
Stiff, Depressed. And two runs more: `Run_Rushed_Loop` (`Rushed/Rushed_FR.bvh`) and `Run_Robot_Loop`
(`Robot/Robot_FR.bvh`). 38 clips.

## What was done to them

`node scripts/anims/style100.mjs`: of each take, between the frames the dataset's own `Frame_Cuts.csv` marks as
good, one stride, left heel to left heel: of the strides that turn less than 0.2 rad and aren't the slower half, the
one whose end is most like its start; turned to run towards +z; the travel taken out, so it runs on the spot; the gap
between its end and its start (and what turn the stride had) spread over it, so it loops; sampled at 30 frames a
second from the capture's 60. An idle is the stretch of standing, four to seven seconds long, whose end is most like its start, closed the same way. Bones are under the cast's names (`Chest4`, which the cast has no bone for, keeps a name
of its own). The fingers weren't captured.
