import { Router, Request, Response } from 'express';
import nodemailer, { SentMessageInfo } from 'nodemailer';

const router = Router();

router.post("/", async (req: Request, res: Response) => {
    const { name, email, message } = req.body as { name: string; email: string; message: string };

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

    transporter.sendMail(mailOptions, (error: Error | null, info: SentMessageInfo) => {
        if (error) {
            console.error("Error sending email: ", error);
            res.status(500).json({ error: "Failed to send email" });
        } else {
            console.log("Email sent:", info.response);
            res.json({ message: "Email sent successfully" });
        }
    });
});

export default router;