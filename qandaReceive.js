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
	} = secrets

	const twilioClient = new Twilio(TWILIO_ACCT_SID, TWILIO_AUTH_TOKEN)
	const errors = []
	const messages = []
	const sendSMS = (messageBody, toNumber) => (
		twilioClient.messages.create({
			to: toNumber || data.From,
			from: TWILIO_PHONE,
			body: messageBody,
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
				if (User.accountSetupStage < 4) {
					// If they haven't, let's update their account with the data they sent us and
					// send them the next message pertintent to their account setup stage.
					switch (User.accountSetupStage) {

						case 0: {
							// Update their account and move them forward in the account setup stage.
							request(GRAPHCOOL_SIMPLE_API_END_POINT, updateUserFirstName(User.id, data.Body))
								// Ask them for the next bit of data.
								.then(() => sendSMS(`Nice to meet you, ${data.Body}. It looks like you're texting from ${data.FromZip}. That's important, because it tells me what timezone you're in (${User.timezone}.) Is that correct? (Reply "Yes" or "No")`))
								.catch(error => errors.push(error))
							break
						}

						case 1: {
							// Check how they replied to the last message.
							const yes = body.includes('yes') || body === 'y'
							const no = body.includes('no') || body === 'n'
							const zipcode = getTimezoneByZipcode(body) && body
							// If they replied "Yes," update their account setup stage and ask the next question.
							if (yes) {
								request(
									GRAPHCOOL_SIMPLE_API_END_POINT,
									moveAccountSetupStageForward(User.id, User.accountSetupStage)
								)
									.then(() => sendSMS('Great! Lastly, do you have a partner you want to share your answers with? (Reply "Yes" or "No)'))
									.catch(error => errors.push(error))
							} else if (no) {
								// If they replied "No" to the zip code question,
								// ask them what their current zipcode is.
								sendSMS('Ok. What is your current, 5-digit zipcode, then?')
							} else if (zipcode) {
								// If they provided a zipcode as their reply,
								// update their account and setup stage and ask the next question.
								request(GRAPHCOOL_SIMPLE_API_END_POINT, updateUserTimezone(User.id, zipcode))
									.then(() => sendSMS(`Great. That means you're texting from ${getTimezoneByZipcode(zipcode)}. I've updated your information. (If that's incorrect, you can change it later.) Lastly, do you have a partner you want to share your answers with? (Reply "Yes" or "No)`))
									.catch(error => errors.push(error))
							} else {
								// If we don't know how they replied, ask the question, again.
								sendSMS("I'm sorry, I didn't quite catch that. What's your current, 5-digit zipcode?")
							}
							break
						}

						case 2: {
							// Check how they replied to the last message.
							const yes = body.includes('yes') || body === 'y'
							const no = body.includes('no') || body === 'n'
							const phoneNumber = phone(body)
							// If they replied "Yes," ask them for their partner's phone number.
							if (yes) {
								sendSMS("That's just what this app was made for! What's your partner's 10-digit phone number? (e.g. 999-999-9999)")
							} else if (no) {
								// If they replied "No," update their account setup stage
								// and let them know the app can work for singles, as well.
								request(
									GRAPHCOOL_SIMPLE_API_END_POINT,
									moveAccountSetupStageForward(User.id, User.accountSetupStage)
								)
									.then(() => sendSMS("That's ok. I'll save your answers just for you, and, as the years go by, you'll get to see how your answers differed over the years."))
									.catch(error => errors.push(error))
							} else if (phoneNumber.length > 0) {
								// If they replied with a valid phone number,
								// check to see if the phone number is tied to an account.
								request(GRAPHCOOL_SIMPLE_API_END_POINT, getUserByPhone(phoneNumber[0]))
									.then(moreServerData => {
										const Partner = moreServerData.User
										// If so, go ahead and set up the relation between the two Users.
										if (Partner) {
											request(GRAPHCOOL_SIMPLE_API_END_POINT, setPartner(User.id, Partner.id))
												// Then move them along the account setup stage.
												.then(() => {
													request(
														GRAPHCOOL_SIMPLE_API_END_POINT,
														moveAccountSetupStageForward(User.id, User.accountSetupStage)
													)
														// Then, finally, send them a message about the success, and ask today's question.
														.then(() => {

														})
												})
												.catch(error => errors.push(error))
										} else {
											// If the phone number is not tied to an account, send the potential partner
											// an invite to the service and move the account set up along.
											request(
												GRAPHCOOL_SIMPLE_API_END_POINT,
												moveAccountSetupStageForward(User.id, User.accountSetupStage)
											)
												.then(() => sendSMS(`${phoneNumber[0]} isn't tied to a user, yet. I sent them an invite to join. In the meantime, go ahead and answer today's question!`))
												.then(() => sendSMSElsewhere(phoneNumber[0], ''))
												.catch(error => errors.push(error))
										}
									})
									.catch(error => errors.push(error))
							} else {
								// If we don't know how they replied, ask the question, again.
								sendSMS("I'm sorry, I didn't quite catch that. Do you have a partner you want to share your answers with? (Reply \"Yes\" or \"No\")")
							}
							break
						}

						case 3: {
							// Check how they replied to the last message.
							const phoneNumber = phone(data.Body)
							// If they replied with a valid phone number,
							if (phoneNumber.length > 0) {
								// Check to see if the phone number is tied to an account.
								request(GRAPHCOOL_SIMPLE_API_END_POINT, getUserByPhone(phoneNumber[0]))
									.then(moreServerData => {
										const Partner = moreServerData.User
										// If so, go ahead and set up the connection between the two Users.
										if (Partner) {
											setPartner(User.id, Partner.id)
										} else {
											// If the phone number is not tied to an account, send the potential partner
											// an invite to the service and move the account set up along.
											request(
												GRAPHCOOL_SIMPLE_API_END_POINT,
												moveAccountSetupStageForward(User.id, User.accountSetupStage)
											)
												.then(() => sendSMS(`${phoneNumber[0]} isn't tied to a user, yet. I sent them an invite to join. In the meantime, go ahead and answer today's question!`))
												.then(() => sendSMSElsewhere(phoneNumber[0], ''))
												.catch(error => errors.push(error))
										}
									})
							}
							break
						}

						default: {
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
							break
						}
					}
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
