export default function handler(req, res) {
  res.setHeader('Content-Type', 'text/plain');
  res.status(200).send(`User-agent: *
Allow: /

User-agent: Mediapartners-Google
Allow: /`);
}
