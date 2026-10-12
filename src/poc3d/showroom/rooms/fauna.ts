import { startFaunaRoom } from './faunaRoom';
import { TOTO_ROWS } from '../../real/faunaRows';

/** Animals of Tōto (models-fauna.html): the candidates are in real/faunaRows.ts. Nothing here is in the city until approved (and then only behind `?fauna=1`). */
startFaunaRoom({ title: 'Animals (Tōto)', room: 'fauna-toto', rows: TOTO_ROWS });
