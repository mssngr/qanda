'use latest'; // eslint-disable-line
import Twilio from 'twilio'
import {request} from 'graphql-request'

const todayObject = new Date()
const today = `${todayObject.getMonth() + 1}/${todayObject.getDate()}`

export default (context, cb) => {
	const {
		TWILIO_ACCT_SID,
		TWILIO_AUTH_TOKEN,
		TWILIO_PHONE,
		GRAPHCOOL_SIMPLE_API_END_POINT,
	} = context.secrets
	const twilioClient = new Twilio(TWILIO_ACCT_SID, TWILIO_AUTH_TOKEN)

	const getMessageData = `{
    allUsers {
      phone
      firstName
    }
    Question(dateToAsk: ${today}) {
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
					}
					else {
						messages.push(message.sid)
					}
				})
			})
		})

	const anyErrors = (errors.length > 0) ? errors : null
	cb(anyErrors, messages)
}
