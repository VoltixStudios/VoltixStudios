// The Pages Function for /reef/* on the studio's site. server/deploy.sh copies this file to
// functions/reef/[[path]].js and the server beside it to functions/_reef/, in the site repository.
import { handle } from '../_reef/play.js';
export const onRequest = ctx => handle(ctx.request, ctx.env);
