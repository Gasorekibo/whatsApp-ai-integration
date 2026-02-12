import google from 'googleapis';
import { OAuth2Client as GoogleOAuth2Client } from 'google-auth-library';
import dbConfig from '../models/index.js';
import dotenv from 'dotenv';
import logger from '../logger/logger.js';

dotenv.config();

class BookingService {
    /**
     * Books a meeting in Google Calendar
     * @param {Object} bookingDetails
     * @returns {Promise<Object>} The created event data
     */
    async bookMeeting(bookingDetails) {
    const {
        title,
        start,
        end,
        description,
        attendeeEmail
    } = bookingDetails;

    const employeeEmail = process.env.EMPLOYEE_EMAIL;

    logger.info('BookingService: Initiating bookMeeting', {
        title,
        start,
        attendeeEmail,
        employeeEmail
    });

    try {
        const employee = await dbConfig.db.Employee.findOne({ where: { email: employeeEmail } });
        if (!employee) {
            return { success: false, error: 'Employee not found - run /auth first' };
        }

        const refreshToken = employee.getDecryptedToken();
        if (!refreshToken) {
            return { success: false, error: 'No valid token - re-authorize at /auth' };
        }

        const oauth2Client = new GoogleOAuth2Client(
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_CLIENT_SECRET,
            process.env.GOOGLE_REDIRECT_URI
        );
        oauth2Client.setCredentials({ refresh_token: refreshToken });

        const calendar = google.google.calendar({ version: 'v3', auth: oauth2Client });

        let allAttendees = [];
        if (attendeeEmail) {
            allAttendees.push({ email: attendeeEmail });
        }

        const employeeInAttendees = allAttendees.some(
            attendee => attendee.email.toLowerCase() === employeeEmail.toLowerCase()
        );

        if (!employeeInAttendees) {
            allAttendees.unshift({
                email: employeeEmail,
                organizer: true,
                responseStatus: 'accepted'
            });
        }

        const event = {
            summary: title,
            description: description || '',
            start: {
                dateTime: start,
                timeZone: 'Africa/Kigali',
            },
            end: {
                dateTime: end,
                timeZone: 'Africa/Kigali',
            },
            attendees: allAttendees,
            conferenceData: {
                createRequest: {
                    requestId: `meet-${Date.now()}`,
                    conferenceSolutionKey: { type: 'hangoutsMeet' }
                }
            },
            reminders: {
                useDefault: false,
                overrides: [
                    { method: 'email', minutes: 24 * 60 },
                    { method: 'popup', minutes: 30 },
                ],
            },
        };

        const response = await calendar.events.insert({
            calendarId: 'primary',
            conferenceDataVersion: 1,
            sendUpdates: 'all',
            resource: event,
        });

        logger.info('BookingService: Meeting booked successfully', {
            eventId: response.data.id,
            link: response.data.htmlLink
        });

        return {
            success: true,
            id: response.data.id,
            link: response.data.htmlLink,
            meetLink: response.data.hangoutLink || response.data.conferenceData?.entryPoints?.[0]?.uri,
            summary: response.data.summary,
            start: response.data.start.dateTime,
            end: response.data.end.dateTime,
            attendees: response.data.attendees,
        };

    } catch (error) {
        logger.error('BookingService: Error booking meeting', {
            error: error.message,
            stack: error.stack,
            errorResponse: error.response?.data
        });
        
        // ✅ Return error object instead of throwing
        return { 
            success: false, 
            error: error.message || 'Failed to create calendar event'
        };
    }
}
}

export const bookingService = new BookingService();
