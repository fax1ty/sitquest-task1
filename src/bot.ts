import axios from 'axios';
import cheerio from 'cheerio';
import { Readable } from 'stream';

import { Low, JSONFile } from 'lowdb';
import path from 'path';
const file = path.join(path.resolve(path.dirname('')), 'db.json');
const adapter = new JSONFile<AppDB>(file);
interface AppDB {
    lastID: number;
}
const db = new Low<AppDB>(adapter);
db.read()
    .then(() => {
        db.data ||= { lastID: -1 }
    });

import dotenv from 'dotenv';
dotenv.config();

import { Telegraf } from 'telegraf';
const bot = new Telegraf(process.env.TELEGRAM_TOKEN);
const CHAT_ID = process.env.TELEGRAM_CHANNEL;
const ENDPOINT = process.env.ENDPOINT;
const UPDATE_INTERVAL = parseFloat(process.env.UPDATE_INTERVAL);

async function getLastDocs() {
    let res = await axios.get(ENDPOINT + '/docs/official-publication');
    let document = cheerio.load(res.data);
    let list = document('.search-result > li');
    let data = list.toArray().map(el => {
        let a = cheerio.load(el)('a');
        return {
            id: parseInt(a.attr('href').split('/')[3]),
            link: a.attr('href'),
            title: a.html()
                .split('\n').join('')
                .split('\t').join('')
                .replace(/\s{2,}/g, '').trim(),
            description: cheerio.load(el)('p').text(),
            attachments: cheerio.load(el)('div > a').toArray().map((el, i) => [
                document(el).text(), // filename
                el.attribs.href, // url
                Array.from(document(el.parent).contents().filter(function () { return this.nodeType == 3; }).text().matchAll(/(\w*?),.*?Б/gm))[i][1] // extension
            ]),
            publishedAt: cheerio.load(el)('p').parent().contents().filter(function () { return this.nodeType == 3; }).text().split('Опубликовано: ')[1]
        }
    });
    return data;
};

function magicInterval(cb: () => any, interval: number) {
    cb();
    setInterval(cb, interval);
}

bot.launch()
    .then(async () => {
        console.log('Bot is working from now!');

        magicInterval(async () => {
            let docs = await getLastDocs();

            if (db.data.lastID < 0) {
                db.data.lastID = docs[0].id;
                await db.write();
                return;
            }
            let newDocs = docs.filter(doc => doc.id > db.data.lastID && (doc.title.includes('Уведомление') || doc.title.includes('Постановление')));
            newDocs.forEach(doc => {
                setTimeout(async () => {
                    await bot.telegram.sendMessage(CHAT_ID, `[${doc.title}](${ENDPOINT + doc.link})\n\n${doc.description}\n\nОпубликовано: ${doc.publishedAt}`, { parse_mode: 'Markdown', disable_web_page_preview: true });
                    doc.attachments.forEach(async attach => {
                        let stream: Readable = (await axios.get(ENDPOINT + attach[1], { responseType: 'stream' })).data;
                        await bot.telegram.sendDocument(CHAT_ID, { filename: attach[0] + '.' + attach[2], source: stream });
                    });
                    db.data.lastID = doc.id;
                    await db.write();

                    console.log(`Sent message to ${CHAT_ID} with doc ${doc.id}`);
                }, 5 * 1000);
            });
        }, UPDATE_INTERVAL * 1000 * 60);
    });


process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));