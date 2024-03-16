const express = require("express");
const router = express.Router();
const nodemailer = require("nodemailer");

router.post("/", async (req, res) => {
	const { name, email, message } = req.body;

	const transporter = nodemailer.createTransport({
		service: "gmail",
		auth: {
			user: "laverdaboom@gmail.com",
			pass: "jjyumkoqzyyqjnwc",
		},
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
