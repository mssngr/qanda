'use latest'; // eslint-disable-line
import Twilio from 'twilio'
import moment from 'moment-timezone'
import zipcodeToTimezone from 'zipcode-to-timezone'
import phone from 'phone'
import {request} from 'graphql-request'

const getTimezoneByZipcode = zipcode => zipcodeToTimezone.lookup(zipcode)

const getUserByPhone = phoneNum => (`{
	User(phone: "${phoneNum}") {
		id
		firstName
		partner
		timezone
	}
}`)

const createUser = (phoneNum, zipcode) => (`{
	createUser(
		phone: "${phoneNum}"
		timezone: "${getTimezoneByZipcode(zipcode)}"
	) {
		id
	}
}`)

const moveAccountSetupStageForward = (id, currentStage) => (`{
	updateUser(
		id: "${id}"
		accountSetupStage: ${currentStage + 1}
	)
}`)

const updateUserFirstName = (id, firstName) => (`{
	updateUser(
		id: "${id}"
		firstName: "${firstName}"
		accountSetupStage: 1
	) {
		id
	}
}`)

const updateUserTimezone = (id, zipcode) => (`{
	updateUser(
		id: "${id}"
		timezone: "${getTimezoneByZipcode(zipcode)}"
		accountSetupStage: 2
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

export default (context, cb) => {
	const {data, secrets} = context
	const body = data.Body.toLowerCase

	const {
		TWILIO_ACCT_SID,
		TWILIO_AUTH_TOKEN,
		TWILIO_PHONE,
		GRAPHCOOL_SIMPLE_API_END_POINT,
		WEBTASK_CONTAINER,
	} = secrets

	const errors = []
	const messages = []
	const wt = require('webtask-require')(WEBTASK_CONTAINER) // eslint-disable-line global-require
	const startWebtask = (taskName, taskData) => wt(taskName, taskData).then(result => messages.push(result))
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

	request(GRAPHCOOL_SIMPLE_API_END_POINT, getUserByPhone(data.From))
		.then(userData => {
			const {User} = userData

			// If there is a User connected to the phone number...
			if (User) {

				/* PENDING PARTNER REQUEST */
				// Check if they have a pending partner request...
				if (User.pendingPartnerPhone) {
					// ...Check to see if they accepted it or declined it.
					if (body.contains('accept')) {
						// If they accepted, get the Partner's data...
						request(GRAPHCOOL_SIMPLE_API_END_POINT, getUserByPhone(User.pendingPartnerPhone))
							.then(partnerData => {
								const Partner = partnerData.User
								// ...And set up the connection between the two Users.
								request(GRAPHCOOL_SIMPLE_API_END_POINT, setPartner(User.id, Partner.id))
									// Then send a message to both Users, signalling success.
									.then(() => {
										sendSMS(`Congrats! You and ${Partner.firstName} are connected. When either of you replies to a Daily Question, the other will be sent the answer. As the years go by, you'll also be reminded of previous years' answers. Have fun!`, User.phone)
										sendSMS(`Congrats! ${User.firstName} accepted your partner request. When either of you replies to a Daily Question, the other will be sent the answer. As the years go by, you'll also be reminded of previous years' answers. Have fun!`, Partner.phone)
									})
									.catch(error => errors.push(error))
							})
					} else if (body.contains('decline')) {
						// If they declined, send a message to the requester and delete the request.
					} else {
						// If their message doesn't accept or decline,
						// ask them about the pending partner, again.
					}
				}

				/* ACCOUNT SETUP */
				// Check if they've completed the account set up.
				if (User.accountSetupStage < 5) {
					// If they haven't, let's shoot them and their message over to account setup
					startWebtask('qandaAccountSetup', {user: User, })
				}

				const currentDate = moment().tz(User.timezone)
				const today = `${currentDate.month() + 1}/${currentDate.date()}`
				request(GRAPHCOOL_SIMPLE_API_END_POINT, getQuestionByDate(today))

			// If there's not a User connected to the phone number...
			} else {
				// ...Create one
				request(GRAPHCOOL_SIMPLE_API_END_POINT, createUser(data.From, data.FromZip))
					.catch(error => errors.push(error))
				// And send a welcome message out to the new user.
				twilioClient.messages.create({
					to: data.From,
					from: TWILIO_PHONE,
					body: "Welcome to Q&A, where you and your partners' answers to daily questions are texted to each other and saved for posterity. Tell me, what's your first name?",
				}, (error, message) => {
					if (error) {
						errors.push(error)
					} else {
						messages.push(message)
					}
				})
			}

			// Check for errors and send any with the callback.
			if (errors.length > 0) {
				cb(errors.toString)
			// If there's none, send the messages with the callback.
			} else {
				cb(null, messages.toString)
			}
		})
}
