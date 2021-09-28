const Datastore = require('nedb');
const cheerio = require('cheerio');
const rp = require('request-promise');
const CronJob = require('cron').CronJob;
const { Telegraf, Markup } = require('telegraf');

let db = new Datastore({filename : '.db'});
db.loadDatabase();
const bot = new Telegraf(process.env.TOKEN);


async function checkBuyAvailable(url){
    let title = url;
    let allowBuy = false;

    await rp(url)
        .then(function(html){
            const htmlFinder = cheerio.load(html);
            title = htmlFinder('h1[itemprop="name"]').toArray()?.[0].children?.[0]?.data?.trim() || url;
            const buyButton = htmlFinder('div[title="Купить"]').toArray()?.[0];
            allowBuy = !!buyButton;
        })
        .catch(function(err){
            //handle error
            console.log('Failed to getting html -> ', err);
        });

    return { allowBuy, title}
}

async function checkIDOK(id){
    let ok = false;
    await rp(`https://re-store.ru/catalog/${id}/`)
        .then(function(html){
            ok = true;
        })
        .catch(function(err){
            //handle error
            console.log(JSON.stringify(err));
            ok = false;
        });

    return ok;
}


bot.start((ctx) =>
    ctx.reply('Welcome! Please send me catalog ID from Re:store.' +
        '\nExample:' +
        '\nMLP23RU-A\n\n\n' +
        'For unsubscribe of catalog item, send /unsubscribe\n\n' +
        'Enjoy!')
);

bot.help((ctx) => {
    ctx.reply('The bot will notify you when the product on site re-store.ru is available for purchase on the site without pre-order \n\n' +
        'For start send me catalog id by example: \n' +
        'MLP23RU-A');
})

bot.command('unsubscribe', (ctx) => {
    db.find({[ctx.chat.id]: true}, {}, function (err, docs){
        if (docs === null || docs?.length === 0) {
            ctx.reply('Nothing to unsubscribe');
            return;
        }

        ctx.reply('Select name to unsubscribe', Markup
            .keyboard(docs.map(({title, id}) => `[${id}] - ${title}`))
            .oneTime()
            .resize()
        );
    })

});

bot.on('message', async (ctx) => {
    const pat = /^\[.+\] - /i
    if (pat.test(ctx.message.text)){
        const id = ctx.message.text.match(/^\[(.+)\] - /, '')?.[1];

        db.findOne({id}, function (err, doc){
            db.update({_id: doc._id}, {
                $set: { [ctx.message.chat.id]: false }
            }, {}, function(){
                ctx.reply(`Unsubscribed from [${id}]`, Markup.removeKeyboard());
            });
        });

        return;
    }

    const id = ctx.message.text;
    ctx.reply(`Start checking id[${id}]...`);
    const isIdOk = await checkIDOK(id);
    if (!isIdOk){
        ctx.reply(`Catalog id not exists, check url -> https://re-store.ru/catalog/${id}`);
        return;
    }
    ctx.reply(`Catalog id[${id}] ok, subscribe to change status...`);

    const {title, allowBuy} = await checkBuyAvailable(`https://re-store.ru/catalog/${id}`);

    db.findOne({id}, function (err, doc){
        if (doc === null){
            db.insert({id, [ctx.message.chat.id]: true, status: allowBuy, title});
            ctx.reply(`Subscribed to [${title}] Success!`);
            ctx.reply(`At now ${title} ${allowBuy ? 'allowed to buy it!' : 'not allowed to buy now :c'}`);
            return;
        }

        db.update({_id: doc._id}, {
            $set: { [ctx.message.chat.id]: true }
        }, {}, function(){
            ctx.reply(`Subscribed to [${title}] Success!`);
            ctx.reply(`At now ${title} ${allowBuy ? 'allowed to buy it!' : 'not allowed to buy now :c'}`);
        });
    });
})



const job = new CronJob(
    '0 0 */4 * * *',
    function () {
        console.log('Parse statuses');
        db.find({}, async function (err, docs){
            await Promise.all(docs.map(async ({id, status, title, _id, ...users}) => {
                console.log(`Check -> https://re-store.ru/catalog/${id}...`);

                const {allowBuy} = await checkBuyAvailable(`https://re-store.ru/catalog/${id}`);
                if (status === allowBuy) return;

                db.update({_id}, {$set: { status: allowBuy }}, {}, function(){
                    Object.keys(users).forEach((chatID) => {
                        if (!users[chatID]) return;

                        bot.telegram.sendMessage(
                            chatID,
                            `Status of [https://re-store.ru/catalog/${id}] is ${allowBuy
                                ? 'allowed to buy it!'
                                : 'not allowed to buy now :c'}`
                        )
                    });
                });
            }));
        })
    },
null, true,
'Europe/Moscow');

bot.launch();
job.start();

process.once('SIGINT', () => {
    job.stop();
    bot.stop('SIGINT');
});

process.once('SIGTERM', () => {
    job.stop();
    bot.stop('SIGTERM');
});


