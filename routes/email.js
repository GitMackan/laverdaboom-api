const express = require("express");
const router = express.Router();
const nodemailer = require("nodemailer");

router.post("/", async(req, res) => {
    const { name, email, message } = req.body;

    const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
            user: process.env.GMAIL_USER,
            pass: process.env.GMAIL_PASS,
        },
        tls: {
            rejectUnauthorized: false
        }
    });

    const mailOptions = {
        from: "laverdaboom@gmail.com",
        to: "sandra.brannstrom@hotmail.com",
        subject: "Meddelande från hemsida",
        text: `
            Name: ${name}
            Email: ${email}
            Message: ${message}
        `,
    };

    transporter.sendMail(mailOptions, (error, info) => {
        console.log("skickar meail")
        if (error) {
            console.error("Error sending email: ", error);
            res.status(500).json({ error: "Failed to send email" });
        } else {
            console.log("Email sent:", info.response);
            res.json({ message: "Email sent successfully" });
        }
    });
});

module.exports = router;