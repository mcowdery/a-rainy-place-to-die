import { startFaunaRoom } from './faunaRoom';
import { MANILA_ROWS } from '../../real/faunaRows';

/** Animals of Manila (models-fauna-ph.html): the candidates are in real/faunaRows.ts. Nothing here is in the city until approved (and then only behind `?fauna=1`). */
startFaunaRoom({ title: 'Animals (Manila)', room: 'fauna-manila', rows: MANILA_ROWS });
