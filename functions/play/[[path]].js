// The Pages Function for /play/* on the studio's site. server/deploy.sh copies this file to
// functions/play/[[path]].js and the server beside it to functions/_play/, in the site repository.
import { handle } from '../_play/play.js';
export const onRequest = ctx => handle(ctx.request, ctx.env);
