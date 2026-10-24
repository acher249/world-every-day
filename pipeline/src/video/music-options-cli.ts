import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { musicOptions, musicOptionWav } from "./music-options.js";

async function main() {
  const [output, video] = process.argv.slice(2);
  if (!output || !video) throw new Error("Usage: music-options-cli.ts <output-directory> <tour.mp4>");
  await mkdir(output, { recursive: true });
  for (const option of musicOptions) {
    await writeFile(join(output, `${option.id}.wav`), musicOptionWav(option));
    await writeFile(join(output, `${option.id}-tour.wav`), musicOptionWav(option, 10));
    await promisify(execFile)("ffmpeg", ["-v", "error", "-y", "-i", video, "-i", join(output, `${option.id}-tour.wav`),
      "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-t", "10", "-movflags", "+faststart", join(output, `${option.id}.mp4`)]);
    console.info(`Created ${option.name}`);
  }
  const cards = musicOptions.map((option, i) => `<article><div class="number">0${i + 1}</div><div><h2>${option.name}</h2><p>${option.description}</p><audio controls preload="none" src="${option.id}.wav"></audio><button data-video="${option.id}.mp4" data-title="${option.name}">Watch with this soundtrack ↗</button></div></article>`).join("\n");
  await writeFile(join(output, "index.html"), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>A World Every Day · Sound studies</title>
<style>*{box-sizing:border-box}body{margin:0;background:#071311;color:#f3f0e6;font:16px/1.6 system-ui,sans-serif}main{max-width:1000px;margin:auto;padding:48px 24px 80px}small,.number{color:#8ee2db;letter-spacing:.16em;font-size:12px}h1,h2{font-family:Georgia,serif;font-weight:400;line-height:1.15}h1{font-size:clamp(38px,6vw,64px);margin:16px 0}h2{font-size:28px;margin:0 0 8px}p{color:#a9bcb7;margin:8px 0 20px}.lead{max-width:660px}video{width:100%;border:1px solid #34443f;border-radius:16px;background:#000}#now{margin:8px 0 30px;color:#8ee2db}article{border-top:1px solid #34443f;padding:28px 0;display:grid;grid-template-columns:50px 1fr;gap:12px}audio{display:block;width:min(100%,540px);height:40px;margin-bottom:16px}button{border:1px solid #65837a;border-radius:100px;background:transparent;color:#c2f4e7;padding:11px 20px;cursor:pointer;font:inherit;font-size:14px}button:hover{background:#16302a}button:focus-visible{outline:2px solid #8ee2db;outline-offset:4px}.note{margin-top:32px;font-size:13px} @media(max-width:600px){main{padding-top:28px}article{grid-template-columns:30px 1fr}}</style>
<main><small>A WORLD EVERY DAY / SOUND STUDIES</small><h1>A little more wonder.</h1><p class="lead">Five original ambient sketches: more movement, warm chimes, still room to breathe. Listen to a 20-second sample, or try it with the ten-second tour.</p><video id="tour" controls playsinline preload="metadata" src="soft-orbit.mp4"></video><p id="now">Soft Orbit · video preview</p>${cards}<p class="note">Original procedural synthesis. No third-party music samples. These are audition options; the daily soundtrack has not changed.</p></main>
<script>const video=document.querySelector('video');const audio=[...document.querySelectorAll('audio')];function pauseAll(except){[video,...audio].forEach(p=>{if(p!==except)p.pause()})}audio.forEach(p=>p.addEventListener('play',()=>pauseAll(p)));video.addEventListener('play',()=>pauseAll(video));document.querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{pauseAll(video);video.src=b.dataset.video;document.getElementById('now').textContent=b.dataset.title+' · video preview';video.play().catch(()=>{});video.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'center'})}));</script></html>`);
  console.info(`Open ${join(output, "index.html")}`);
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "Music audition failed"); process.exitCode = 1; });
