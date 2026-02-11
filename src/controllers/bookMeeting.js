import { bookingService } from '../services/booking.service.js';
import dotenv from 'dotenv';
dotenv.config();

const bookMeetingHandler = async (req, res) => {
  const {
    title: meetingTitle,
    start: startTime,
    end: endTime,
    description,
    attendeeEmail
  } = req.body;

  if (!meetingTitle || !startTime || !endTime) {
    return res.status(400).json({
      error: 'Missing required fields: meetingTitle, startTime, endTime'
    });
  }

  try {
    const result = await bookingService.bookMeeting({
      title: meetingTitle,
      start: startTime,
      end: endTime,
      description,
      attendeeEmail
    });

    res.json({
      success: true,
      message: 'Meeting booked successfully! Check your calendar.',
      event: result
    });

  } catch (error) {
    console.error('❌ Error booking meeting:', error);

    if (error.message.includes('Insufficient permissions') || error.message.includes('re-authorize')) {
      return res.status(error.message.includes('permissions') ? 403 : 401).json({
        error: error.message,
        message: 'Re-authorize at /auth',
      });
    }

    res.status(500).json({
      error: 'Failed to book meeting',
      details: error.message
    });
  }
};
export default bookMeetingHandler;