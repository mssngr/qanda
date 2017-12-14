'use latest';
import twilio from 'twilio'
import {request} from 'graphql-request'

module.exports = (context, cb) => {
  const {
    TWILIO_ACCT_SID,
    TWILIO_AUTH_TOKEN,
    TWILIO_PHONE,
    GRAPHCOOL_SIMPLE_API_END_POINT,
    GRAPHCOOL_WEBTASK_AUTH_TOKEN,
  } = context.secrets
  const twilioClient = new twilio(TWILIO_ACCT_SID, TWILIO_AUTH_TOKEN)
  
  const getAllUsersPhones = `{
    allUsers {
      phone
    }
  }`
  
  const errors = []
  const messages = []
  
  request(GRAPHCOOL_SIMPLE_API_END_POINT, getAllUsersPhones)
    .then(data => {
      data.allUsers.forEach(user => {
        twilioClient.messages.create({
        	to: user.phone,
        	from: TWILIO_PHONE,
        	body: 'Hello! Hope you’re having a good day!',
        }, (err, message) => {
        	if (err) {
        		errors.push(err)
        	} else {
        	  messages.push(message.sid)
        	}
        })
      })
    })
  
  const anyErrors = (errors.length > 0) ? errors : null
  cb(anyErrors, messages)
}
