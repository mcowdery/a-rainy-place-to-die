# The prototype (not canon)

The game ships test content that was written to prove the VN and phone systems, not as story. **None of it is
part of the main story**, and nothing in this bible builds on it:

- `content/vn/s90` ("Kaburo nights"): Mama-san at Bar Kanpai, the knock at Hotel Rouge's Room 303.
- `content/phone/mama.yaml`, `kirishima.yaml`, `matchbook.yaml`, `unknown.yaml`, and their media.
- Their flags: `met_mama`, `asked_detective`, `heard_room_303`, `saw_keep_bottle`, `saw_photo`, `got_matchbook`,
  `mama_invited`, `saw_rouge_tape`, `kirishima_wary`, `matchbook_hint`.
- The nodes they use keep working: `bar_kanpai.mama`, `bar_kanpai.detective` (the man in a trench coat) and
  `hotel_rouge.room_303` (which needs `heard_room_303`). The places themselves (Bar Kanpai, Hotel Rouge) stay in
  the city; what happens in them is up to the real story.

It stays in the game until the real story replaces it, then goes (with the tests that play it, and the
`16_kirishima_poster` ad if the name doesn't survive). `content/phone/kaiwa.yaml` (the messenger's welcome) isn't
story and stays.
