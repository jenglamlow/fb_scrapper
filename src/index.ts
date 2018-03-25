import dateFormat = require("dateformat");
import fastpriorityqueue = require("fastpriorityqueue");
import fs = require("fs");
import json2csv = require("json2csv");
import puppeteer = require("puppeteer");

import config from "./config";

const email: string = config.EMAIL;
const pass: string = config.PASS;
const groupId: string  = process.argv[2];
const deep: number = 2;
const fbUrl: string = "https://mbasic.facebook.com";

const buffer = new fastpriorityqueue((a, b) => (a.comment + a.reaction) > (b.comment + b.reaction));

(async () => {
    const browser = await puppeteer.launch({headless: true});
    const page = await browser.newPage();

    // Go to Facebook main page
    await page.goto(fbUrl);

    page.on("console", (msg) => console.log("", msg.text()));

    // Login
    await page.waitForSelector("input");

    // Enter login credential
    await page.evaluate((email, pass) => {
        const elEmail = document.getElementsByName("email")[0] as HTMLInputElement;
        const elPass = document.getElementsByName("pass")[0] as HTMLInputElement;
        const elLogin = document.getElementsByName("login")[0] as HTMLInputElement;
        elEmail.value = email;
        elPass.value = pass;

        elLogin.click();
    }, email, pass);

    console.log("Login success");

    // Wait for page to load
    // Bypass OneClick login
    await page.waitForSelector(".bi");
    await page.evaluate(() => {
        const elOk = document.getElementsByClassName("bp")[0] as HTMLInputElement;
        if (elOk) {
            elOk.click();
        }
    });

    // Wait for page to load
    await page.waitForNavigation();

    // Go to the Group
    const groupUrl = fbUrl + "/groups/" + groupId;
    await page.goto(groupUrl, { waitUntil: "load" });
    console.log("Go to " + groupUrl);

    for (let i = 0; i < deep; i++) {
        // Get Post article (Filter out the shared render article post)
        const idList = await page.evaluate(() => {
            const articles = Array.from(document.querySelectorAll("div[role='article'][data-ft]"));
            return articles.map((article) => article.id);
        });

        const promises = [];

        // Go through each ID list and get the post
        idList.forEach(async (id) => {
            const post = await getPost(page, id).catch(() => {
                console.log("error detected");
            });
            // Only process those post with reactions and comments
            const value = post.comment + post.reaction;
            if (value) {
                promises.push(post);
                buffer.add(post);
            }
        });

        // Wait all Promises resolve
        await Promise.all(promises).then(() => {
            // console.log("all promises");
        });

        // Go to more post
        const linkHandler = (await page.$x("//a/span[contains(text(), 'See more posts')]/parent::a"))[0];
        if (linkHandler) {
            await linkHandler.click();
            await page.waitForNavigation();
        }
        process.stdout.write(".");
    }

    // Print out the result
    const topN = 50;
    const topBuffer = [];

    for (let i = 0; i < topN; i++) {
        if (!buffer.isEmpty()) {
            topBuffer.push(buffer.poll());
        }
    }

    generate_csv(groupId, topBuffer);

    // await page.screenshot({path: "fb.png", fullPage: true});

    await browser.close();
})();

async function getPost(page, id: string) {
    const divId = "#" + id;
    const obj = await page.$eval(divId, (el, divId) => {
        const post = {
            comment: 0,
            link: "",
            reaction: 0,
            time: "",
        };

        // Get the last two of div, it is where the reaction and comment is
        const divs = Array.from(el.querySelectorAll("div[class]")).slice(-2) as HTMLDivElement[];
        if (divs.length) {
            // Filter out advertisment
            const N = divs[1].className.split(" ").length;

            // Reaction and Like Comment has 2 classname
            if (N === 2) {
                // Get post time
                const abbr = divs[0].querySelector("abbr");
                post.time = abbr.textContent;

                const elImpact = Array.from(divs[1].querySelectorAll("a[href][class]"));

                // If length = 2, means it has comment and reactions
                // Else only Comment
                if (elImpact.length === 1) {
                    // Comment Only
                    const comment = elImpact[0].textContent.split(" ");
                    if (comment[0] !== "Comment") {
                        post.comment = parseInt(comment[0], 10);
                    }
                } else if (elImpact.length === 2) {
                    // Reaction and Comment
                    post.reaction = parseInt(elImpact[0].textContent, 10);
                    const comment = elImpact[1].textContent.split(" ");
                    if (comment[0] !== "Comment") {
                        post.comment = parseInt(comment[0], 10);
                    }
                } else {
                    // Unexpected error
                    throw new Error("Not length 1 and 2 for impact");
                }

                // Get Full Story Link
                const a = divs[1].querySelectorAll("a");
                a.forEach((link) => {
                    if (link.textContent === "Full Story") {
                        post.link = link.href.replace("mbasic", "www").replace(/(?<=permalink&id=\d+)&.*/g, "");
                    }
                });
            }
        }
        // console.log("---------------------------");
        return post;
    }, divId);

    return Promise.resolve(obj);
}

function generate_csv(name, buffer) {
    const now = new Date();
    const date = dateFormat(now, "yyyymmdd");
    const filename = date + "_" + name + ".csv";

    const Json2csvParser = json2csv.Parser;
    const fields = ["time", "reaction", "comment", "link"];

    const json2csvParser = new Json2csvParser({ fields });
    const csv = json2csvParser.parse(buffer);

    fs.writeFile(filename, csv, (err) => {
        if (err) {
            return console.log(err);
        }
        console.log("Successfully write to ", filename);
    });
}
