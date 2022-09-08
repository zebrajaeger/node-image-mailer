"use strict";

let path = require('node:path');
const fs = require('fs');

const nodemailer = require("nodemailer");
const {v4: uuidv4} = require('uuid');
const commander = require('commander');

const credentials = require('./credentials.json');
const packageJson = require('./package.json');

// TODO add progress bar
const cliProgress = require('cli-progress');
// const bar1 = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
// bar1.start(200, 0);
// bar1.update(100);
// bar1.stop();

async function main() {
    commander
        .version(packageJson.version, '-v, --version')
        .option('-d, --dry-run', 'Dont send mail')
        .option('-t, --to <value>', 'Mail to.')
        .option('-p, --path <value>', 'Files dir.', '.')
        .option('-s, --subject <value>', 'Mail subject.')
        .option('-m, --max-size <value>', 'Max attachment size (default; 8MB)', (8 * 1024 * 1024).toString())
        .parse(process.argv);

    const options = commander.opts();

    const maxSize = Number.parseInt(options.maxSize);

    let dirToSend = options.path
    if (!path.isAbsolute(dirToSend)) {
        console.log('debug: path is relative')
        dirToSend = path.resolve(__dirname, dirToSend)
    }
    options.path = dirToSend

    const filter = (/\.(gif|jpe?g|tiff?|png|webp|bmp)$/i)
    const from = credentials.user
    const to = options.to
    if (!to) {
        throw '-t or --to option isrequired';
    }
    const subject = options.subject || path.parse(dirToSend).base;
    options.subject = subject;

    console.log({options})

    const mailsToSend = [];
    let mailCount = 1;
    const filesToSend = []
    let currentSize = 0;
    fs.readdirSync(dirToSend).forEach(f => {
        const file = path.resolve(dirToSend, f)
        if (filter.test(file)) {
            let stats = fs.statSync(file);
            let size = stats.size;
            if (currentSize + size > maxSize) {
                mailsToSend.push({
                    attachments: [...filesToSend],
                    size: currentSize,
                    sizeT: formatNumber(currentSize),
                    count: mailCount
                })
                mailCount++;
                currentSize = 0;
                filesToSend.length = 0
            } else {
                filesToSend.push({
                    path: file,
                    file: path.parse(file).base,
                    cid: uuidv4(),
                    size,
                    sizeT: formatNumber(size)
                });
                currentSize += size;
            }
        }
    })

    if (filesToSend.length > 0) {
        mailsToSend.push({
            attachments: [...filesToSend],
            size: currentSize,
            sizeT: formatNumber(currentSize),
            count: mailCount
        })
        currentSize = 0;
        filesToSend.length = 0
    }

    mailsToSend.forEach(mail => {
        mail.subject = `${subject} (${mail.count}/${mailsToSend.length})`
        let html = '';
        mail.attachments.forEach(attachment => {
            attachment.cid = uuidv4();
            let p = path.parse(attachment.file);
            html += `${p.base}:<br><img src="cid:${attachment.cid}"><br><br>`
        })
        mail.html = html;
    })

    sendMails(mailsToSend, from, to, options.dryRun)
}


async function sendMails(mails, from, to, dryRun) {

    let transporter = nodemailer.createTransport({
        host: credentials.host,
        port: credentials.port,
        secure: true,
        auth: {
            user: credentials.user,
            pass: credentials.pass
        },
    });

    for (let mail of mails) {
        mail.to = to;
        mail.from = from;
        console.log('send', mail);
        if (!dryRun) {
            const info = await transporter.sendMail(mail);
            console.log("Message sent: %s", info.messageId);
        }
    }
}

function formatNumber(num) {
    return num.toString().replace(/(\d)(?=(\d{3})+(?!\d))/g, '$1.')
}

main().catch(console.error);
