'use latest'; // eslint-disable-line
import Twilio from 'twilio'
import zipcodeToTimezone from 'zipcode-to-timezone'
import {GraphQLClient} from 'graphql-request'

console.log('Started qandaReceive')

/* GRAPHQL REQUESTS */
const getUserByPhone = phoneNum => (`{
	User(phone: "${phoneNum}") {
		id
		firstName
		accountSetupStage
		partner {
			id
		}
		timezone
	}
}`)

const getTimezoneByZipcode = zipcode => zipcodeToTimezone.lookup(zipcode)
const createUser = (phoneNum, zipcode) => (`mutation {
	createUser(
		phone: "${phoneNum}"
		timezone: "${getTimezoneByZipcode(zipcode)}"
	) {
		id
	}
}`)

const setPartner = (user1Id, user2Id) => (`{
	setPartner(
		partner1UserId: "${user1Id}"
		partner2UserId: "${user2Id}"
	) {
		partner1User {
			id
		}
		partner2User {
			id
		}
	}
}`)

const getQuestionByDate = date => (`{
	Question(dateToAsk: "${date}") {
		text
		answers {
			id
		}
	}
}`)

/* MODULE BODY */
export default (context, cb) => {
	const {data, secrets} = context

	/* MODIFIED DATA */
	// Modify the incoming data to grab message specifics
	const userMessage = data.Body
	const userMessageLC = userMessage.toLowerCase()
	// Check for common replies in the User's message
	const yes = userMessageLC.includes('yes') || userMessageLC === 'y'
	const no = userMessageLC.includes('no') || userMessageLC === 'n'

	/* ACCOUNT SECRETS */
	const {
		TWILIO_ACCT_SID,
		TWILIO_AUTH_TOKEN,
		TWILIO_PHONE,
		GRAPHCOOL_SIMPLE_API_END_POINT,
		GRAPHCOOL_WEBTASK_AUTH_TOKEN,
		WEBTASK_CONTAINER,
	} = secrets

	/* STORAGE FOR RESULTS OF WEBTASK */
	const errors = []
	const messages = []

	/* TOOLS */
	// Make the Graphcool requests less verbose
	const graphQLClient = new GraphQLClient(GRAPHCOOL_SIMPLE_API_END_POINT, {
		headers: {
			Authorization: `Bearer ${GRAPHCOOL_WEBTASK_AUTH_TOKEN}`,
		},
	})
	const rq = req => graphQLClient.request(req)
	const rqCatch = req => rq(req).catch(error => errors.push(error))
	const rqThen = (req, then, then2, then3) => {
		if (then3) return rq(req).then(then).then(then2).then(then3).catch(error => errors.push(error))
		if (then2) return rq(req).then(then).then(then2).catch(error => errors.push(error))
		return rq(req).then(then).catch(error => errors.push(error))
	}
	// Make the Webtask requests less verbose
	const wt = require('webtask-require')(WEBTASK_CONTAINER) // eslint-disable-line global-require
	const startWebtask = (taskName, taskData) => wt(taskName, taskData)
		.then(result => messages.push(result))
		.catch(error => errors.push(error))
	// Make the Twilio requests less verbose
	const twilioClient = new Twilio(TWILIO_ACCT_SID, TWILIO_AUTH_TOKEN)
	const sendSMS = (smsBody, toNumber) => (
		twilioClient.messages.create({
			to: toNumber || data.From,
			from: TWILIO_PHONE,
			body: smsBody,
		}, (error, message) => {
			if (error) {
				errors.push(error)
			} else {
				messages.push(message)
			}
		})
	)

	/* HANDLE RECEIVED MESSAGE */
	rq(getUserByPhone(data.From))
		.then(userData => {
			const {User} = userData
			console.log('made the request for the user')

			// If there is a User connected to the phone number...
			if (User) {
				console.log('there is a user')
				console.log(User)

				/* ACCOUNT SETUP */
				// Check if they've completed the account set up.
				if (User.accountSetupStage < 5) {
					console.log('account setup')
					// If they haven't, let's shoot them and their message data over to account setup
					wt('chainTest2', {data: 'test', foo: {bar: true}})
					cb(null, 'finished')
				}

				// const currentDate = moment().tz(User.timezone)
				// const today = `${currentDate.month() + 1}/${currentDate.date()}`
				// request(GRAPHCOOL_SIMPLE_API_END_POINT, getQuestionByDate(today))
			} else if (yes) {

				/* ACCOUNT CREATION */
				// If there's not a User connected to the phone number,
				// and they answered "yes" to setting up an account,
				// create one for them
				rq(createUser(data.From, data.FromZip))
					.then(result => {
						sendSMS(`Fantastic! What's your first name?`)
						if (errors.length > 0) {
							cb(errors.toString())
						// If there's none, send the messages with the callback.
						} else {
							cb(null, result)
						}
					})
					.catch(error => {
						errors.push(error)
						if (errors.length > 0) {
							cb(errors.toString())
						// If there's none, send the messages with the callback.
						} else {
							cb(null, messages.toString())
						}
					})
				// The created "User" has a default "accountSetupStage" of 0,
				// So, when they reply, they will be routed to "qandaAccountSetup"
			} else if (no) {
				// If they answered "no" to setting up an account, thank them for their time
			} else {
				// Otherwise, act like this is the first time they've ever messaged
				// and ask them if they want to create an account
				sendSMS(`Welcome to Q&A, a simple SMS app that asks you daily questions and sends your answers to your partner. Q&A also saves your answers, year after year, so you can see how your answers have changed over time.\n\nWould you like me to create an account for you?\n(Reply "Yes" or "No")`)
			}

			// request(GRAPHCOOL_SIMPLE_API_END_POINT, createUser(data.From, data.FromZip))
			// 	.catch(error => errors.push(error))
			// // And send a welcome message out to the new user.
			// twilioClient.messages.create({
			// 	to: data.From,
			// 	from: TWILIO_PHONE,
			// 	body: "Welcome to Q&A, where you and your partners' answers to daily questions are texted to each other and saved for posterity. Tell me, what's your first name?",
			// }, (error, message) => {
			// 	if (error) {
			// 		errors.push(error)
			// 	} else {
			// 		messages.push(message)
			// 	}
			// })

			// /* PENDING PARTNER REQUEST */
			// // Check if they have a pending partner request...
			// if (User.pendingPartnerPhone) {
			// 	// ...Check to see if they accepted it or declined it.
			// 	if (body.contains('accept')) {
			// 		// If they accepted, get the Partner's data...
			// 		request(GRAPHCOOL_SIMPLE_API_END_POINT, getUserByPhone(User.pendingPartnerPhone))
			// 			.then(partnerData => {
			// 				const Partner = partnerData.User
			// 				// ...And set up the connection between the two Users.
			// 				request(GRAPHCOOL_SIMPLE_API_END_POINT, setPartner(User.id, Partner.id))
			// 					// Then send a message to both Users, signalling success.
			// 					.then(() => {
			// 						sendSMS(`Congrats! You and ${Partner.firstName} are connected. When either of you replies to a Daily Question, the other will be sent the answer. As the years go by, you'll also be reminded of previous years' answers. Have fun!`, User.phone)
			// 						sendSMS(`Congrats! ${User.firstName} accepted your partner request. When either of you replies to a Daily Question, the other will be sent the answer. As the years go by, you'll also be reminded of previous years' answers. Have fun!`, Partner.phone)
			// 					})
			// 					.catch(error => errors.push(error))
			// 			})
			// 	} else if (body.contains('decline')) {
			// 		// If they declined, send a message to the requester and delete the request.
			// 	} else {
			// 		// If their message doesn't accept or decline,
			// 		// ask them about the pending partner, again.
			// 	}
			// }

			// // Check for errors and send any with the callback.
			// if (errors.length > 0) {
			// 	cb(errors.toString())
			// // If there's none, send the messages with the callback.
			// } else {
			// 	cb(null, messages.toString())
			// }
		})
		.catch(error => cb(error))
}
