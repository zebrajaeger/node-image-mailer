"use strict";

let path = require('node:path');
const fs = require('fs');

const nodemailer = require("nodemailer");
const {v4: uuidv4} = require('uuid');
const commander = require('commander');
const winston = require('winston')

const credentials = require('./credentials.json');
const packageJson = require('./package.json');

// logger
const consoleTransport = new winston.transports.Console()
const myformat = winston.format.combine(
    winston.format.colorize({message: true, colors: {info: 'blue',}}),
    winston.format.timestamp(),
    winston.format.align(),
    winston.format.printf(info => `${info.timestamp} ${info.level}: ${info.message}`)
);
const myWinstonOptions = {
    transports: [new winston.transports.Console({
        format: myformat
    })]
}
const LOG = new winston.createLogger(myWinstonOptions)

function generateEmailData(dirToSend, maxSize) {
    const mailsToSend = [];
    let mailCount = 1;
    const filesToSend = []
    let currentSize = 0;
    const filter = (/\.(gif|jpe?g|tiff?|png|webp|bmp)$/i)
    fs.readdirSync(dirToSend).forEach(f => {
        const file = path.resolve(dirToSend, f)
        if (filter.test(file)) {
            let stats = fs.statSync(file);
            let size = stats.size;
            if (currentSize + size > maxSize) {
                mailsToSend.push({
                    attachments: [...filesToSend],
                    size: currentSize,
                    sizeT: formatBytes(currentSize),
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
                    sizeT: formatBytes(size)
                });
                currentSize += size;
            }
        }
    })

    if (filesToSend.length > 0) {
        mailsToSend.push({
            attachments: [...filesToSend],
            size: currentSize,
            sizeT: formatBytes(currentSize),
            count: mailCount
        })
        currentSize = 0;
        filesToSend.length = 0
    }
    return mailsToSend;
}

async function main() {
    LOG.debug(process.argv)
    let receiver = undefined;
    commander
        .version(packageJson.version, '-v, --version')
        .option('-d, --dry-run', 'Dont send mail')
        .option('-p, --path <value>', 'Files dir.', process.cwd())
        .option('-s, --subject <value>', 'Mail subject.')
        .option('-m, --max-size <value>', 'Max attachment size (default; 8MB)', (8 * 1024 * 1024).toString());
    commander
        .addArgument(new commander.Argument('<receiver>', 'Mail to. Mail or targets-name from credentials.json'))
        .action((receiver_) => {
            receiver = receiver_;
        });
    commander.parse();
    const options = commander.opts();

    // maxSize
    const maxSize = Number.parseInt(options.maxSize);

    // directory
    let dirToSend = options.path
    if (!path.isAbsolute(dirToSend)) {
        LOG.info('path is relative')
        dirToSend = path.resolve(__dirname, dirToSend)
    }
    options.path = dirToSend

    // receiver
    options.receiver = receiver
    credentials.receivers?.forEach(receiver_ => {
        if (receiver_.name === receiver && !!receiver_.email) {
            options.receiver = receiver_.email;
        }
    })
    LOG.info(`send to '${options.receiver}'`)

    // subject
    const subject = options.subject || path.parse(dirToSend).base;
    options.subject = subject;
    LOG.info(JSON.stringify(options))
    const mailsToSend = generateEmailData(dirToSend, maxSize);

    mailsToSend.forEach(mail => {
        mail.subject = `${subject} (${mail.count}/${mailsToSend.length})`
        let html = '';
        mail.attachments.forEach(attachment => {
            attachment.cid = uuidv4();
            let p = path.parse(attachment.file);
            html += `${p.base}:<br><img src="cid:${attachment.cid}" alt="${p.base}"><br><br>`
        })
        mail.html = html;
    })

    await sendMails(mailsToSend, credentials.user, options.receiver, options.dryRun)
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
        LOG.info(JSON.stringify(mail, null, 4))
        if (!dryRun) {
            await transporter.sendMail(mail, (err, info) => {
                console.log(err, info)
            });
        }
    }
}

function formatNumber(num) {
    return num.toString().replace(/(\d)(?=(\d{3})+(?!\d))/g, '$1.')
}

function formatBytes(bytes, decimals = 2) {
    if (!+bytes) return '0 Bytes'

    const k = 1024
    const dm = decimals < 0 ? 0 : decimals
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']

    const i = Math.floor(Math.log(bytes) / Math.log(k))

    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`
}

if (require.main === module) {
    main().catch(console.error);
}

module.exports = main