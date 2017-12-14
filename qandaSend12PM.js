'use latest';
import twilio from 'twilio'
import {request} from 'graphql-request'

export default (context, cb) => {
  const {
    TWILIO_ACCT_SID,
    TWILIO_AUTH_TOKEN,
    TWILIO_PHONE,
    GRAPHCOOL_SIMPLE_API_END_POINT,
    GRAPHCOOL_WEBTASK_AUTH_TOKEN,
  } = context.secrets
  const twilioClient = new twilio(TWILIO_ACCT_SID, TWILIO_AUTH_TOKEN)

  const getMessageData = `{
    allUsers {
      phone
      firstName
    }
    Question(dateToAsk: "12/14") {
      text
    }
  }`

  const errors = []
  const messages = []

  request(GRAPHCOOL_SIMPLE_API_END_POINT, getMessageData)
    .then(data => {
      data.allUsers.forEach(user => {
        twilioClient.messages.create({
        	to: user.phone,
        	from: TWILIO_PHONE,
        	body: `Hello, ${user.firstName}. ${data.Question.text}`,
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
