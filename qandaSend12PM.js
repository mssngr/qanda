'use latest'; // eslint-disable-line
import Twilio from 'twilio'
import {GraphQLClient} from 'graphql-request'

const todayObject = new Date()
const today = `${todayObject.getMonth() + 1}/${todayObject.getDate()}`

/* GRAPHQL REQUESTS */
const getMessageData = `{
	allUsers {
		phone
		firstName
	}
	Question(dateToAsk: "${today}") {
		text
	}
}`

export default (context, cb) => {
	/* ACCOUNT SECRETS */
	const {
		TWILIO_ACCT_SID,
		TWILIO_AUTH_TOKEN,
		TWILIO_PHONE,
		GRAPHCOOL_SIMPLE_API_END_POINT,
		GRAPHCOOL_WEBTASK_AUTH_TOKEN,
	} = context.secrets

	/* TOOLS */
	// Handle the webtask success callbacks
	const cblog = successMsg => {
		console.log(successMsg)
		cb(null, successMsg)
	}
	// Make the Graphcool requests less verbose
	const graphQLClient = new GraphQLClient(GRAPHCOOL_SIMPLE_API_END_POINT, {
		headers: {
			Authorization: `Bearer ${GRAPHCOOL_WEBTASK_AUTH_TOKEN}`,
		},
	})
	const rq = req => graphQLClient.request(req)
	// Make the Twilio requests less verbose
	const twilioClient = new Twilio(TWILIO_ACCT_SID, TWILIO_AUTH_TOKEN)
	const sendSMS = (smsBody, toNumber) => (
		twilioClient.messages.create({
			to: toNumber,
			from: TWILIO_PHONE,
			body: smsBody,
		}, error => error && cb(error))
	)

	/* SEND DAILY MESSAGES */
	rq(getMessageData)
		.then(data => {
			data.allUsers.forEach(user => {
			  console.log(user.firstName, data.Question.text, user.phone)
				sendSMS(
					`Hey, ${user.firstName}! Today's question is:\n${data.Question.text}`,
					user.phone
				)
			})
		})
		.then(() => cblog(allUsers, `Sent daily messages.`))
		.catch(error => cb(error))
}
