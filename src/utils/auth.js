import { OAuth2Client } from 'google-auth-library';
import dotenv from 'dotenv';
dotenv.config();

const oauth2Client = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

export default oauth2Client;